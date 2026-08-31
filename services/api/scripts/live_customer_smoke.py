"""Run the real customer PDF pipeline through quote creation.

This intentionally stops before quote acceptance so it never creates a print
job or sends paper to an agent. It uses only the public customer capability
contract and is safe to run against the canary shop.
"""

from __future__ import annotations

import argparse
import io
import time

import httpx
from pypdf import PdfWriter


def _test_pdf() -> bytes:
    output = io.BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=612, height=792)
    writer.write(output)
    return output.getvalue()


def main() -> None:
    parser = argparse.ArgumentParser(description="AutoPrint live customer pipeline smoke test")
    parser.add_argument("--api-url", default="http://127.0.0.1:8000")
    parser.add_argument("--shop-code", default="CANARY01")
    parser.add_argument("--timeout", type=int, default=90)
    args = parser.parse_args()

    pdf_bytes = _test_pdf()
    client = httpx.Client(
        base_url=args.api_url.rstrip("/"),
        headers={"X-AutoPrint-Contract-Version": "3"},
        timeout=30,
    )

    order_response = client.post(f"/api/v3/shops/{args.shop_code}/orders", json={})
    order_response.raise_for_status()
    order = order_response.json()
    order_id = order["order_id"]
    capability = order["capability_token"]
    capability_headers = {"X-AutoPrint-Capability": capability}
    print(f"ORDER_CREATED={order_id}")

    intent_response = client.post(
        f"/api/v3/orders/{order_id}/upload-intent",
        headers=capability_headers,
        json={
            "original_file_name": "autoprint-live-smoke.pdf",
            "declared_media_type": "application/pdf",
            "byte_size": len(pdf_bytes),
        },
    )
    intent_response.raise_for_status()
    intent = intent_response.json()
    print("UPLOAD_INTENT=OK")

    upload_response = httpx.put(
        intent["signed_upload_url"],
        headers={"x-upsert": "false"},
        data={"cacheControl": "3600"},
        files={"": ("autoprint-live-smoke.pdf", pdf_bytes, "application/pdf")},
        timeout=30,
    )
    upload_response.raise_for_status()
    print("SIGNED_UPLOAD=OK")

    finalize_response = client.post(
        f"/api/v3/orders/{order_id}/finalize-upload",
        headers=capability_headers,
        json={"source_document_id": intent["source_document_id"]},
    )
    finalize_response.raise_for_status()
    print("UPLOAD_FINALIZED=OK")

    deadline = time.monotonic() + args.timeout
    while time.monotonic() < deadline:
        detail_response = client.get(
            f"/api/v3/orders/{order_id}", headers=capability_headers
        )
        detail_response.raise_for_status()
        status = detail_response.json()["order"]["status"]
        if status == "ready_for_approval":
            print("PREPARATION_WORKER=OK")
            break
        if status in {"failed", "rejected", "cancelled"}:
            raise RuntimeError(f"Preparation ended with status {status}")
        time.sleep(1)
    else:
        raise TimeoutError("Preparation worker did not make the order ready in time")

    quote_response = client.post(
        f"/api/v3/orders/{order_id}/quotes",
        headers=capability_headers,
        json={"options": {"copies": 1, "color_mode": "bw", "duplex": False}},
    )
    quote_response.raise_for_status()
    quote = quote_response.json()
    print(f"QUOTE_CREATED={quote['quote_id']}")
    print(f"QUOTE_TOTAL={quote['total_amount']} {quote['currency']}")
    print("CUSTOMER_PIPELINE_SMOKE=PASS")


if __name__ == "__main__":
    main()
