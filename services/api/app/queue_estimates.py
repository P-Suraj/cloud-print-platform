from pydantic import BaseModel

class QueueEstimateResult(BaseModel):
    estimated_min_minutes: int
    estimated_max_minutes: int
    confidence: str # 'high', 'medium', or 'unavailable'
    queue_depth: int
    agent_freshness_seconds: float
    customer_wording: str

def format_queue_estimate(db_result: dict) -> QueueEstimateResult:
    """
    Parses the result from autoprint_v3.calculate_queue_estimate RPC
    and generates the customer-friendly string.
    """
    if "error" in db_result:
        return QueueEstimateResult(
            estimated_min_minutes=0,
            estimated_max_minutes=0,
            confidence="unavailable",
            queue_depth=0,
            agent_freshness_seconds=-1.0,
            customer_wording="Estimate unavailable"
        )

    estimated_min = db_result.get("estimated_min", 0)
    estimated_max = db_result.get("estimated_max", 0)
    confidence = db_result.get("confidence", "unavailable")
    queue_depth = max(0, int(db_result.get("queue_depth", 0)))
    freshness = float(db_result.get("agent_freshness_seconds", -1.0))

    if confidence not in ("high", "medium") or freshness < 0:
        wording = "Estimate unavailable (Printer status unconfirmed)"
    elif estimated_max < 5:
        wording = "Ready soon (< 5 min)"
    else:
        wording = f"Likely ready in {estimated_min}\u2013{estimated_max} min"

    return QueueEstimateResult(
        estimated_min_minutes=estimated_min,
        estimated_max_minutes=estimated_max,
        confidence=confidence,
        queue_depth=queue_depth,
        agent_freshness_seconds=freshness,
        customer_wording=wording
    )
