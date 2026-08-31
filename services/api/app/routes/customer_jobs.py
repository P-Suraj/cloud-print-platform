from fastapi import APIRouter, HTTPException, Header, Request
from typing import Optional
import time

from app.capabilities import hash_capability_token
from app.db import get_supabase_client, get_public_supabase_client
from app.customer_auth import require_customer_session

router = APIRouter(prefix="/api/v3/orders", tags=["Customer Jobs"])

def _customer_lifecycle(jobs):
    statuses = [job.get("status") for job in jobs]
    if jobs and all(value == "completed" for value in statuses): current = "ready_for_pickup"
    elif "printing" in statuses: current = "printing"
    elif any(job.get("approved_at") for job in jobs): current = "approved"
    else: current = "file_queued"
    keys = ["file_queued", "approved", "printing", "ready_for_pickup"]
    labels = ["File Queued", "Approved", "Printing", "Ready for Pickup"]
    at = keys.index(current)
    return {"current": current, "steps": [{"key": key, "label": labels[index], "state": "completed" if index < at else "active" if index == at else "upcoming"} for index, key in enumerate(keys)]}


@router.post("/{order_id}/check-in")
async def check_in_customer(
    order_id: str,
    request: Request,
    x_autoprint_capability: Optional[str] = Header(None),
):
    if not x_autoprint_capability:
        raise HTTPException(status_code=404, detail="Order not found")
    session = require_customer_session(request, require_csrf=True)
    result = get_supabase_client().rpc("check_in_remote_order", {
        "p_order_id": order_id,
        "p_capability_hash": hash_capability_token(x_autoprint_capability),
        "p_customer_id": session["customer_id"],
    }).execute()
    if not result.data:
        raise HTTPException(status_code=409, detail="This order cannot be checked in")
    return {"status": "checked_in", "order_id": order_id}

@router.get("/{order_id}/status")
async def get_customer_job_status(order_id: str, x_autoprint_capability: Optional[str] = Header(None)):
    if not x_autoprint_capability:
        raise HTTPException(status_code=404, detail="Order not found")

    cap_h = hash_capability_token(x_autoprint_capability)
    client = get_supabase_client()

    now_str = time.strftime('%Y-%m-%d %H:%M:%S+00', time.gmtime())
    order_res = client.table("orders").select(
        "*, print_jobs(*, print_artifacts(logical_page_count,source_documents(original_file_name)), price_quote_items(options_json), price_quotes(options_json))"
    ).eq("id", order_id).eq("capability_hash", cap_h).gt("expires_at", now_str).execute()
    if not order_res.data:
        raise HTTPException(status_code=404, detail="Order not found")

    order = order_res.data[0]
    jobs = order.get("print_jobs", [])
    job = jobs[0] if jobs else None
    shop_name = "Your print shop"
    try:
        shop_res = get_public_supabase_client().table("shops").select("name").eq("id", order["shop_id"]).limit(1).execute()
        if shop_res.data:
            shop_name = shop_res.data[0].get("name") or shop_name
    except Exception:
        pass

    documents = []
    for item in jobs:
        artifact = item.get("print_artifacts") or {}
        source = artifact.get("source_documents") or {}
        quote_item = item.get("price_quote_items") or {}
        quote = item.get("price_quotes") or {}
        if isinstance(quote_item, list):
            quote_item = quote_item[0] if quote_item else {}
        if isinstance(quote, list):
            quote = quote[0] if quote else {}
        options = item.get("shop_options_override_json") or quote_item.get("options_json") or quote.get("options_json") or {}
        documents.append({
            "name": source.get("original_file_name") or "Print document",
            "page_count": artifact.get("logical_page_count"),
            "copies": options.get("copies", 1),
            "color_mode": options.get("color_mode", "bw"),
            "duplex": bool(options.get("duplex", False)),
        })

    status_wording = {
        "uploading": "Uploading document...",
        "preparing": "Server validating PDF and calculating options...",
        "ready_for_approval": "Ready for shop approval",
        "waiting_for_shop": "Awaiting shop approval",
        "printing": "Submitted to shop printing workflow",
        "needs_attention": "Outcome verification in progress",
        "completed": "Confirmed printed",
        "failed": "Printing failed",
        "rejected": "Job rejected by shopkeeper",
        "cancelled": "Order cancelled"
    }

    # A batch is complete only when every line is complete. Surface the most
    # operationally important state while individual jobs continue through the
    # unchanged v3 state machine.
    job_statuses = [item.get("status") for item in jobs]
    if jobs and all(value == "completed" for value in job_statuses):
        raw_status = "completed"
    elif "needs_attention" in job_statuses:
        raw_status = "needs_attention"
    elif "printing" in job_statuses:
        raw_status = "printing"
    elif "failed" in job_statuses:
        raw_status = "failed"
    elif "rejected" in job_statuses:
        raw_status = "rejected"
    elif jobs and all(value == "cancelled" for value in job_statuses):
        raw_status = "cancelled"
    elif jobs:
        raw_status = "waiting_for_shop"
    else:
        raw_status = order["status"]
    customer_wording = status_wording.get(raw_status, raw_status)
    pickup_status = None
    pickup_id = None

    if order.get("fulfillment_mode") == "remote" and raw_status == "completed":
        try:
            p_res = client.table("pickups").select("id, status").eq("order_id", order_id).execute()
            if p_res.data:
                pickup_id = p_res.data[0]["id"]
                pickup_status = p_res.data[0]["status"]
                if pickup_status == "ready_for_pickup":
                    customer_wording = "Printed and ready for collection"
                elif pickup_status == "collected":
                    customer_wording = "Order collected"
                elif pickup_status == "hold_expired":
                    customer_wording = "Hold period expired. Please contact counter staff."
                elif pickup_status == "no_show":
                    customer_wording = "Order marked as uncollected"
                elif pickup_status == "awaiting_print":
                    customer_wording = "Printed — preparing pickup"
        except Exception:
            pass

    if job and raw_status == "waiting_for_shop" and job.get("approved_at"):
        if order.get("fulfillment_mode") == "remote" and not order.get("customer_checked_in_at") and job.get("print_eligibility") == "check_in_required":
            customer_wording = "Approved — waiting for your arrival and check-in"
        elif job.get("print_eligibility") == "shop_risk_accepted":
            customer_wording = "Approved — the shop accepted unpaid preprint risk"
        else:
            customer_wording = "Approved — queued for printing"

    exception = {"rejected": "Rejected", "cancelled": "Cancelled", "failed": "Print failed", "needs_attention": "Needs attention"}.get(raw_status)
    return {
        "order_id": order_id,
        "job_id": job["id"] if job else None,
        "job_ids": [item["id"] for item in jobs],
        "document_count": len(jobs),
        "completed_count": sum(1 for value in job_statuses if value == "completed"),
        "status": raw_status,
        "pickup_id": pickup_id,
        "pickup_status": pickup_status,
        "customer_wording": customer_wording,
        "customer_lifecycle": _customer_lifecycle(jobs),
        "customer_exception": exception,
        "shop_name": shop_name,
        "customer_job_name": order.get("customer_job_name"),
        "documents": documents,
        "completion_source": job.get("completion_source") if job else None,
        "fulfillment_mode": order.get("fulfillment_mode", "counter"),
        "payment_mode": order.get("payment_mode", "pay_at_pickup"),
        "print_eligibility": job.get("print_eligibility") if job else None,
        "customer_checked_in": bool(order.get("customer_checked_in_at")),
        "cancellation_allowed": bool(
            jobs
            and all(item.get("status") == "waiting_for_shop" and not item.get("current_attempt_id") for item in jobs)
        ),
        "cancellation_reason": (
            None if jobs and all(item.get("status") == "waiting_for_shop" and not item.get("current_attempt_id") for item in jobs)
            else "Printing has already started or the order is terminal."
        ),
    }
