from datetime import datetime, timezone
import hashlib
import json
import time
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from app.capabilities import hash_capability_token
from app.db import get_supabase_client
from app.pricing import calculate_quote_price

router = APIRouter(prefix="/api/v3", tags=["Quotes"])


class CreateQuoteItemRequest(BaseModel):
    source_document_id: str
    options: Dict[str, Any]


class CreateQuoteRequest(BaseModel):
    # Keep the legacy one-document request compatible while all new clients
    # submit explicit items and receive an authoritative batch quote.
    options: Optional[Dict[str, Any]] = None
    items: Optional[List[CreateQuoteItemRequest]] = Field(default=None, max_length=20)


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _now_str() -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S+00", time.gmtime())


def _parse_dt(value: str) -> Optional[datetime]:
    if not value:
        return None
    try:
        normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
        parsed = datetime.fromisoformat(normalized)
        return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed
    except ValueError:
        return None


def _json_hash(value: Any) -> str:
    canonical = json.dumps(value, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _requested_items(order: dict, request: CreateQuoteRequest) -> List[dict]:
    documents = order.get("source_documents") or []
    allowed_ids = {str(document["id"]) for document in documents}
    if request.items:
        requested = [item.model_dump() for item in request.items]
    elif request.options is not None and documents:
        requested = [{"source_document_id": documents[0]["id"], "options": request.options}]
    else:
        raise HTTPException(status_code=422, detail="At least one quote item is required")
    document_ids = [str(item["source_document_id"]) for item in requested]
    if len(document_ids) != len(set(document_ids)):
        raise HTTPException(status_code=422, detail="A document can appear only once in a batch quote")
    if any(document_id not in allowed_ids for document_id in document_ids):
        raise HTTPException(status_code=404, detail="A quote document does not belong to this order")
    return requested


@router.post("/orders/{order_id}/quotes")
async def create_quote(
    order_id: str,
    req: CreateQuoteRequest,
    x_autoprint_capability: Optional[str] = Header(None),
):
    if not x_autoprint_capability:
        raise HTTPException(status_code=404, detail="Order not found")
    cap_h = hash_capability_token(x_autoprint_capability)
    client = get_supabase_client()
    order_res = (
        client.table("orders").select("*, source_documents(id, original_file_name)")
        .eq("id", order_id).eq("capability_hash", cap_h).gt("expires_at", _now_str()).execute()
    )
    if not order_res.data:
        raise HTTPException(status_code=404, detail="Order not found")
    order = order_res.data[0]
    requested = _requested_items(order, req)

    rate_res = (
        client.table("rate_cards").select("*").eq("shop_id", order["shop_id"])
        .is_("retired_at", "null").order("version", desc=True).execute()
    )
    if not rate_res.data:
        raise HTTPException(status_code=422, detail="No active rate card configured for this shop")
    rate_card = rate_res.data[0]
    names = {str(doc["id"]): doc.get("original_file_name") or "Print document" for doc in order.get("source_documents") or []}

    persisted_items = []
    for line in requested:
        document_id = str(line["source_document_id"])
        artifact_res = (
            client.table("print_artifacts").select("id, source_document_id, sha256, logical_page_count")
            .eq("source_document_id", document_id).order("preparation_version", desc=True).limit(1).execute()
        )
        if not artifact_res.data:
            raise HTTPException(status_code=400, detail=f"{names[document_id]} is not ready for pricing")
        artifact = artifact_res.data[0]
        try:
            amount, breakdown = calculate_quote_price(artifact["logical_page_count"], line["options"], rate_card["rules_json"])
        except (TypeError, ValueError, KeyError) as exc:
            raise HTTPException(status_code=422, detail=f"{names[document_id]}: {exc}") from exc
        persisted_items.append({
            "source_document_id": document_id,
            "original_file_name": names[document_id],
            "artifact_id": artifact["id"],
            "artifact_sha256": artifact["sha256"],
            "options_json": line["options"],
            "options_hash": _json_hash(line["options"]),
            "breakdown_json": breakdown,
            "total_amount": amount,
        })

    total_amount = round(sum(float(item["total_amount"]) for item in persisted_items), 2)
    batch_identity = [{
        "artifact_id": item["artifact_id"], "artifact_sha256": item["artifact_sha256"], "options_hash": item["options_hash"]
    } for item in persisted_items]
    expires_at = time.strftime("%Y-%m-%d %H:%M:%S+00", time.gmtime(time.time() + 900))
    created = client.rpc("create_batch_price_quote", {
        "p_order_id": order_id,
        "p_capability_hash": cap_h,
        "p_rate_card_id": rate_card["id"],
        "p_rate_card_version": rate_card["version"],
        "p_items": persisted_items,
        "p_total_amount": total_amount,
        "p_batch_options_hash": _json_hash(batch_identity),
        "p_expires_at": expires_at,
    }).execute()
    result = created.data[0] if isinstance(created.data, list) and created.data else created.data
    if not result:
        raise HTTPException(status_code=409, detail="Batch quote could not be created")
    return {
        "status": "batch_quote_created", "quote_id": result["quote_id"], "total_amount": total_amount,
        "currency": "INR", "expires_at": expires_at, "items": result.get("items", []),
        "breakdown": {"item_count": len(persisted_items), "total_amount": total_amount, "currency": "INR"},
    }


@router.post("/quotes/{quote_id}/accept")
async def accept_quote(
    quote_id: str,
    x_autoprint_capability: Optional[str] = Header(None),
    idempotency_key: Optional[str] = Header(None),
):
    if not x_autoprint_capability:
        raise HTTPException(status_code=404, detail="Order not found")
    cap_h = hash_capability_token(x_autoprint_capability)
    client = get_supabase_client()
    quote_res = client.table("price_quotes").select("*, orders(*), price_quote_items(id)").eq("id", quote_id).execute()
    if not quote_res.data:
        raise HTTPException(status_code=404, detail="Quote not found")
    quote = quote_res.data[0]
    order = quote["orders"]
    if cap_h != order["capability_hash"]:
        raise HTTPException(status_code=404, detail="Order capability mismatch")
    order_expires = _parse_dt(order.get("expires_at"))
    if not order_expires or _now_utc() > order_expires:
        raise HTTPException(status_code=404, detail="Order not found")
    expires_at = _parse_dt(quote.get("expires_at"))
    if not expires_at or _now_utc() > expires_at:
        raise HTTPException(status_code=400, detail="Quote has expired — request a new quote")

    key_hash = hashlib.sha256(idempotency_key.encode()).hexdigest() if idempotency_key else None
    request_hash = hashlib.sha256(f"accept:{quote_id}".encode()).hexdigest()
    rpc_name = "accept_batch_quote" if quote.get("price_quote_items") else "accept_price_quote"
    accepted = client.rpc(rpc_name, {
        "p_quote_id": quote_id, "p_capability_hash": cap_h,
        "p_idempotency_key_hash": key_hash, "p_request_hash": request_hash,
    }).execute()
    if not accepted.data:
        raise HTTPException(status_code=409, detail="Quote acceptance failed")
    return accepted.data
