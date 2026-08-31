from datetime import datetime, time, date, timezone, timedelta
from typing import List, Dict, Any, Optional
from zoneinfo import ZoneInfo

# Fallback timezone offsets when system IANA tz database is missing (e.g. Windows without tzdata)
KNOWN_TIMEZONES = {
    "Asia/Kolkata": timezone(timedelta(hours=5, minutes=30)),
    "Asia/Calcutta": timezone(timedelta(hours=5, minutes=30)),
    "UTC": timezone.utc,
}

def parse_time_str(t_str: str) -> time:
    """Parse HH:MM or HH:MM:SS into datetime.time object."""
    if isinstance(t_str, time):
        return t_str
    parts = t_str.split(":")
    if len(parts) == 2:
        return time(int(parts[0]), int(parts[1]))
    elif len(parts) >= 3:
        # handle fractional seconds if present
        sec_parts = parts[2].split(".")
        return time(int(parts[0]), int(parts[1]), int(sec_parts[0]))
    raise ValueError(f"Invalid time format: {t_str}")

def get_timezone_object(tz_name: str) -> Any:
    """Safely obtain a timezone object, falling back to known static offsets on Windows."""
    try:
        return ZoneInfo(tz_name)
    except Exception:
        return KNOWN_TIMEZONES.get(tz_name, KNOWN_TIMEZONES["Asia/Kolkata"])

def compute_is_open_now(
    weekly_hours: List[Dict[str, Any]],
    exceptions: List[Dict[str, Any]],
    manual_closed_override: bool = False,
    manual_closed_until: Optional[Any] = None,
    shop_timezone: str = "Asia/Kolkata",
    now_utc: Optional[datetime] = None,
) -> Dict[str, Any]:
    """
    Evaluate if a shop is currently open based on:
    1. Manual closed override (highest priority)
    2. Specific date exception (holiday / special hours)
    3. Regular weekly schedule (day of week: 0=Sunday, 1=Monday... 6=Saturday)
    Supports cross-midnight overnight shifts.
    """
    if _is_manual_closed_active(manual_closed_override, manual_closed_until, now_utc):
        return {
            "is_open": False,
            "reason": "manual_override",
            "opens_at": None,
            "closes_at": None
        }

    tz = get_timezone_object(shop_timezone or "Asia/Kolkata")

    current_dt = (now_utc or datetime.now(timezone.utc)).astimezone(tz)
    current_date = current_dt.date()
    current_time = current_dt.time()
    # Python weekday(): Monday is 0, Sunday is 6.
    # Postgres / AutoPrint standard: Sunday is 0, Monday is 1 ... Saturday is 6.
    dow = (current_dt.weekday() + 1) % 7
    prev_dow = (dow - 1) % 7

    # Check date-specific exception for today first
    current_date_str = current_date.isoformat()
    for exc in exceptions:
        exc_date = exc.get("exception_date")
        if isinstance(exc_date, date):
            exc_date = exc_date.isoformat()
        if exc_date == current_date_str:
            if exc.get("is_closed"):
                return {
                    "is_open": False,
                    "reason": "holiday",
                    "opens_at": None,
                    "closes_at": None
                }
            opens_at = exc.get("opens_at")
            closes_at = exc.get("closes_at")
            if opens_at and closes_at:
                t_open = parse_time_str(str(opens_at))
                t_close = parse_time_str(str(closes_at))
                if _is_time_between(current_time, t_open, t_close):
                    return {
                        "is_open": True,
                        "reason": "open",
                        "opens_at": str(opens_at),
                        "closes_at": str(closes_at)
                    }
                else:
                    return {
                        "is_open": False,
                        "reason": "outside_hours",
                        "opens_at": str(opens_at),
                        "closes_at": str(closes_at)
                    }

    # Index weekly hours by day_of_week
    schedule_by_dow = {h.get("day_of_week"): h for h in weekly_hours}

    # Check if continuing an overnight shift from previous day
    prev_schedule = schedule_by_dow.get(prev_dow)
    if prev_schedule and not prev_schedule.get("is_closed"):
        p_open_str = prev_schedule.get("opens_at")
        p_close_str = prev_schedule.get("closes_at")
        if p_open_str and p_close_str:
            t_p_open = parse_time_str(str(p_open_str))
            t_p_close = parse_time_str(str(p_close_str))
            if t_p_open > t_p_close and current_time <= t_p_close:
                return {
                    "is_open": True,
                    "reason": "open",
                    "opens_at": str(p_open_str),
                    "closes_at": str(p_close_str)
                }

    # Check today's schedule
    day_schedule = schedule_by_dow.get(dow)
    if not day_schedule:
        return {
            "is_open": False,
            "reason": "no_hours_set",
            "opens_at": None,
            "closes_at": None
        }

    if day_schedule.get("is_closed"):
        return {
            "is_open": False,
            "reason": "closed_day",
            "opens_at": None,
            "closes_at": None
        }

    opens_at = day_schedule.get("opens_at")
    closes_at = day_schedule.get("closes_at")
    if not opens_at or not closes_at:
        return {
            "is_open": False,
            "reason": "no_hours_set",
            "opens_at": None,
            "closes_at": None
        }

    t_open = parse_time_str(str(opens_at))
    t_close = parse_time_str(str(closes_at))

    if t_open <= t_close:
        if t_open <= current_time <= t_close:
            return {
                "is_open": True,
                "reason": "open",
                "opens_at": str(opens_at),
                "closes_at": str(closes_at)
            }
        else:
            return {
                "is_open": False,
                "reason": "outside_hours",
                "opens_at": str(opens_at),
                "closes_at": str(closes_at)
            }
    else:
        # Overnight shift starting today
        if current_time >= t_open:
            return {
                "is_open": True,
                "reason": "open",
                "opens_at": str(opens_at),
                "closes_at": str(closes_at)
            }
        else:
            return {
                "is_open": False,
                "reason": "outside_hours",
                "opens_at": str(opens_at),
                "closes_at": str(closes_at)
            }

def _is_time_between(check_time: time, start_time: time, end_time: time) -> bool:
    """Check if check_time is within start_time and end_time, supporting overnight hours."""
    if start_time <= end_time:
        return start_time <= check_time <= end_time
    else:
        return check_time >= start_time or check_time <= end_time


def _is_manual_closed_active(
    manual_closed_override: bool,
    manual_closed_until: Optional[Any],
    now_utc: Optional[datetime],
) -> bool:
    """Manual closures are fail-safe but always time-bounded."""
    if not manual_closed_override or not manual_closed_until:
        return False
    try:
        until = manual_closed_until
        if isinstance(until, str):
            until = datetime.fromisoformat(until.replace("Z", "+00:00"))
        if until.tzinfo is None:
            return False
        current = now_utc or datetime.now(timezone.utc)
        return until.astimezone(timezone.utc) > current.astimezone(timezone.utc)
    except (TypeError, ValueError):
        return False
