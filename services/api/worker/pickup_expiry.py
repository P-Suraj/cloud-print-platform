#!/usr/bin/env python3
"""
AutoPrint Phase 3 Background Worker: Pickup Expiry & Reminders
Executes idempotent expire_due_pickups RPC against PostgreSQL using FOR UPDATE SKIP LOCKED.
Can be run as a one-shot command or continuously in a loop.
Includes metrics and health tracking for operational monitoring.
"""

import sys
import time
import argparse
import logging
from datetime import datetime, timezone
from typing import Dict, Any

from app.db import get_supabase_client

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("pickup_expiry_worker")

# In-process operational health state
_worker_state: Dict[str, Any] = {
    "status": "idle",
    "last_run_at": None,
    "last_success_at": None,
    "last_error": None,
    "total_cycles": 0,
    "total_expired": 0,
    "consecutive_errors": 0
}


def get_worker_health() -> Dict[str, Any]:
    """Retrieve current worker health and execution metrics."""
    return dict(_worker_state)


def run_pickup_expiry_cycle() -> int:
    """Execute one expiration cycle across all eligible shops."""
    now_iso = datetime.now(timezone.utc).isoformat()
    _worker_state["last_run_at"] = now_iso
    _worker_state["total_cycles"] += 1
    _worker_state["status"] = "running"

    client = get_supabase_client()
    try:
        res = client.rpc("expire_due_pickups").execute()
        expired_count = res.data or 0
        _worker_state["total_expired"] += expired_count
        _worker_state["last_success_at"] = now_iso
        _worker_state["consecutive_errors"] = 0
        _worker_state["last_error"] = None
        _worker_state["status"] = "healthy"

        if expired_count > 0:
            logger.info("Expired %d due pickup(s)", expired_count)
        return expired_count
    except Exception as exc:
        _worker_state["consecutive_errors"] += 1
        _worker_state["last_error"] = str(exc)
        _worker_state["status"] = "degraded"
        logger.error("Failed to run expire_due_pickups: %s", exc)
        return 0


def main():
    parser = argparse.ArgumentParser(description="AutoPrint v3 Pickup Expiry Worker")
    parser.add_argument("--once", action="store_true", help="Run a single expiry check cycle and exit")
    parser.add_argument("--interval", type=int, default=60, help="Loop interval in seconds (default: 60)")
    args = parser.parse_args()

    logger.info("Starting pickup expiry worker (mode=%s)...", "once" if args.once else f"loop:{args.interval}s")

    if args.once:
        count = run_pickup_expiry_cycle()
        logger.info("One-shot cycle finished. %d pickups expired. Health: %s", count, _worker_state["status"])
        sys.exit(0 if _worker_state["status"] == "healthy" else 1)

    while True:
        try:
            run_pickup_expiry_cycle()
        except KeyboardInterrupt:
            logger.info("Worker stopped by user.")
            break
        except Exception as exc:
            logger.error("Unhandled worker error: %s", exc)
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
