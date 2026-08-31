"""Exercise the complete M1 HTTP vertical slice without claiming paper output.

The script creates a temporary confirmed operator and enrolled device, runs a
real customer order through the live API, reports the device result as
uncertain, resolves it as failed, then removes the temporary operator. The
revoked device and failed job remain as audit evidence.
"""

from __future__ import annotations

import io
import os
import secrets
import time
import uuid

import httpx
import psycopg2
from pypdf import PdfWriter


API_URL = os.getenv("TEST_API_URL", "http://127.0.0.1:8000").rstrip("/")
SHOP_CODE = os.getenv("TEST_SHOP_CODE", "CANARY01")
CONTRACT_HEADERS = {"X-AutoPrint-Contract-Version": "3"}
SMOKE_FILENAMES = ("vertical-smoke.pdf", "autoprint-live-smoke.pdf")


def checked(response: httpx.Response) -> dict:
    if not response.is_success:
        raise RuntimeError(
            f"{response.request.method} {response.request.url} -> "
            f"{response.status_code}: {response.text}"
        )
    return response.json() if response.content else {}


def test_pdf() -> bytes:
    output = io.BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=595, height=842)
    writer.write(output)
    return output.getvalue()


def main() -> None:
    required = ("DATABASE_URL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")
    missing = [name for name in required if not os.getenv(name)]
    if missing:
        raise RuntimeError(f"Missing environment variables: {', '.join(missing)}")

    suffix = uuid.uuid4().hex
    email = f"autoprint-smoke-{suffix}@example.invalid"
    password = secrets.token_urlsafe(32)
    auth_user_id = None
    app_user_id = None
    device_id = None

    admin_headers = {
        "apikey": os.environ["SUPABASE_SERVICE_ROLE_KEY"],
        "User-Agent": "AutoPrint-Vertical-Smoke/1.0",
        "Content-Type": "application/json",
    }
    admin = httpx.Client(
        base_url=os.environ["SUPABASE_URL"].rstrip("/"),
        headers=admin_headers,
        timeout=30,
    )
    db = psycopg2.connect(os.environ["DATABASE_URL"])

    try:
        created = checked(admin.post("/auth/v1/admin/users", json={
            "email": email,
            "password": password,
            "email_confirm": True,
            "user_metadata": {"purpose": "autoprint_vertical_smoke"},
        }))
        auth_user_id = created["id"]

        with db.cursor() as cursor:
            cursor.execute(
                "SELECT id FROM public.shops WHERE shop_code = %s AND migration_mode::text = 'v3_canary'",
                (SHOP_CODE,),
            )
            shop = cursor.fetchone()
            if not shop:
                raise RuntimeError(f"Verified canary shop {SHOP_CODE} was not found")
            shop_id = str(shop[0])
            cursor.execute(
                """
                INSERT INTO autoprint_v3.users
                  (identity_provider, identity_subject, email, display_name)
                VALUES ('supabase', %s, %s, 'Vertical Smoke Operator')
                RETURNING id
                """,
                (auth_user_id, email),
            )
            app_user_id = str(cursor.fetchone()[0])
            cursor.execute(
                """
                INSERT INTO autoprint_v3.shop_memberships (shop_id, user_id, role, active)
                VALUES (%s, %s, 'owner', true)
                """,
                (shop_id, app_user_id),
            )
        db.commit()
        print("TEMPORARY_OPERATOR=READY")

        owner = httpx.Client(
            base_url=API_URL,
            headers=CONTRACT_HEADERS,
            timeout=30,
        )
        login = checked(owner.post("/api/v3/auth/login", json={
            "email": email,
            "password": password,
        }))
        csrf = login["csrf_token"]
        owner_headers = {"X-AutoPrint-CSRF": csrf}
        print("OWNER_LOGIN=OK")

        # Reconcile only artifacts created by these smoke-test scripts. A prior
        # interrupted run may have left a valid lease behind; these scripts
        # never submit anything to a physical printer, so `failed` is the only
        # truthful terminal result. Never touch customer-named documents here.
        with db.cursor() as cursor:
            cursor.execute(
                """
                SELECT pj.id, pa.id, pa.fencing_token, pa.device_id,
                       pa.lease_expires_at > now() AS lease_is_live
                FROM autoprint_v3.print_jobs pj
                JOIN autoprint_v3.print_attempts pa ON pa.id = pj.current_attempt_id
                JOIN autoprint_v3.print_artifacts art ON art.id = pj.artifact_id
                JOIN autoprint_v3.source_documents doc ON doc.id = art.source_document_id
                WHERE pj.shop_id = %s
                  AND pj.status = 'printing'
                  AND doc.original_file_name = ANY(%s)
                """,
                (shop_id, list(SMOKE_FILENAMES)),
            )
            stale_attempts = cursor.fetchall()
            for stale_job_id, stale_attempt_id, fence, stale_device_id, lease_is_live in stale_attempts:
                if lease_is_live:
                    cursor.execute(
                        "SELECT autoprint_v3.report_print_outcome(%s, %s, %s, %s, 'failed', NULL, %s::jsonb)",
                        (
                            stale_job_id,
                            stale_attempt_id,
                            fence,
                            stale_device_id,
                            '{"test_cleanup":"Smoke script never submitted paper"}',
                        ),
                    )
                else:
                    cursor.execute(
                        "SELECT autoprint_v3.mark_expired_attempts_uncertain(%s)",
                        (stale_device_id,),
                    )
        db.commit()

        with db.cursor() as cursor:
            cursor.execute(
                """
                SELECT pj.id
                FROM autoprint_v3.print_jobs pj
                JOIN autoprint_v3.print_artifacts art ON art.id = pj.artifact_id
                JOIN autoprint_v3.source_documents doc ON doc.id = art.source_document_id
                WHERE pj.shop_id = %s
                  AND pj.status = 'needs_attention'
                  AND doc.original_file_name = ANY(%s)
                """,
                (shop_id, list(SMOKE_FILENAMES)),
            )
            uncertain_smoke_job_ids = [str(row[0]) for row in cursor.fetchall()]
        for stale_job_id in uncertain_smoke_job_ids:
            checked(owner.post(
                f"/api/v3/shop/jobs/{stale_job_id}/resolve",
                headers=owner_headers,
                json={
                    "outcome_status": "failed",
                    "reason": "Interrupted smoke test: no paper was submitted",
                },
            ))

        enrollment = checked(owner.post(
            f"/api/v3/shops/{shop_id}/device-enrollment-codes",
            headers=owner_headers,
        ))
        enrolled = checked(owner.post("/api/v3/devices/enroll", json={
            "enrollment_code": enrollment["enrollment_code"],
            "display_name": "Vertical Smoke Device",
            "expected_shop_id": shop_id,
        }))
        device_id = enrolled["device_id"]
        device_headers = {
            "X-AutoPrint-Device-Id": device_id,
            "X-AutoPrint-Device-Secret": enrolled["device_secret"],
        }
        checked(owner.post("/api/v3/agent/heartbeat", headers=device_headers, json={
            "agent_version": "vertical-smoke",
            "printer_status_bw": "test-no-paper",
            "printer_status_color": "test-no-paper",
        }))
        print("DEVICE_ENROLLMENT_AND_HEARTBEAT=OK")

        customer = httpx.Client(
            base_url=API_URL,
            headers=CONTRACT_HEADERS,
            timeout=30,
        )
        document = test_pdf()
        order = checked(customer.post(f"/api/v3/shops/{SHOP_CODE}/orders", json={}))
        order_id = order["order_id"]
        cap_headers = {"X-AutoPrint-Capability": order["capability_token"]}
        intent = checked(customer.post(
            f"/api/v3/orders/{order_id}/upload-intent",
            headers=cap_headers,
            json={
                "original_file_name": "vertical-smoke.pdf",
                "declared_media_type": "application/pdf",
                "byte_size": len(document),
            },
        ))
        upload = httpx.put(
            intent["signed_upload_url"],
            headers={"x-upsert": "false"},
            data={"cacheControl": "3600"},
            files={"": ("vertical-smoke.pdf", document, "application/pdf")},
            timeout=30,
        )
        upload.raise_for_status()
        checked(customer.post(
            f"/api/v3/orders/{order_id}/finalize-upload",
            headers=cap_headers,
            json={"source_document_id": intent["source_document_id"]},
        ))

        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            detail = checked(customer.get(
                f"/api/v3/orders/{order_id}", headers=cap_headers
            ))
            status = detail["order"]["status"]
            if status == "ready_for_approval":
                break
            if status in {"failed", "rejected", "cancelled"}:
                raise RuntimeError(f"Preparation ended with status {status}")
            time.sleep(1)
        else:
            raise TimeoutError("Preparation worker timed out")
        print("CUSTOMER_UPLOAD_AND_PREPARATION=OK")

        quote = checked(customer.post(
            f"/api/v3/orders/{order_id}/quotes",
            headers=cap_headers,
            json={"options": {"copies": 1, "color_mode": "bw", "duplex": False}},
        ))
        idempotency_key = str(uuid.uuid4())
        accept_headers = {**cap_headers, "Idempotency-Key": idempotency_key}
        accepted = checked(customer.post(
            f"/api/v3/quotes/{quote['quote_id']}/accept", headers=accept_headers
        ))
        replay = checked(customer.post(
            f"/api/v3/quotes/{quote['quote_id']}/accept", headers=accept_headers
        ))
        if accepted["job_id"] != replay["job_id"]:
            raise RuntimeError("Quote acceptance idempotency failed")
        job_id = accepted["job_id"]
        print("QUOTE_ACCEPTANCE_IDEMPOTENCY=OK")

        checked(owner.post(
            f"/api/v3/shop/jobs/{job_id}/approve", headers=owner_headers
        ))
        print("SHOP_APPROVAL=OK")

        for _ in range(20):
            claim = checked(owner.post(
                "/api/v3/agent/jobs/claim",
                headers=device_headers,
                json={"lease_seconds": 300},
            ))
            if claim.get("job_id") == job_id:
                break
            if claim.get("status") != "claimed":
                raise RuntimeError(f"Device did not claim the vertical smoke job: {claim}")

            with db.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT doc.original_file_name
                    FROM autoprint_v3.print_jobs pj
                    JOIN autoprint_v3.print_artifacts art ON art.id = pj.artifact_id
                    JOIN autoprint_v3.source_documents doc ON doc.id = art.source_document_id
                    WHERE pj.id = %s
                    """,
                    (claim["job_id"],),
                )
                claimed_document = cursor.fetchone()
            if not claimed_document or claimed_document[0] not in SMOKE_FILENAMES:
                raise RuntimeError(
                    f"Refusing to reconcile non-smoke FIFO job {claim['job_id']}"
                )
            checked(owner.post(
                f"/api/v3/agent/attempts/{claim['attempt_id']}/outcome",
                headers=device_headers,
                json={
                    "job_id": claim["job_id"],
                    "fencing_token": claim["fencing_token"],
                    "outcome_status": "failed",
                    "completion_source": None,
                    "evidence_json": {"test": "Interrupted smoke test; no paper submitted"},
                },
            ))
        else:
            raise RuntimeError("More than 20 prior smoke jobs were queued")
        checked(owner.post(
            f"/api/v3/agent/attempts/{claim['attempt_id']}/outcome",
            headers=device_headers,
            json={
                "job_id": job_id,
                "fencing_token": claim["fencing_token"],
                "outcome_status": "needs_attention",
                "completion_source": None,
                "evidence_json": {"test": "No physical print was submitted"},
            },
        ))
        checked(owner.post(
            f"/api/v3/shop/jobs/{job_id}/resolve",
            headers=owner_headers,
            json={
                "outcome_status": "failed",
                "reason": "Vertical smoke test: no paper submitted",
            },
        ))
        final_status = checked(customer.get(
            f"/api/v3/orders/{order_id}/status", headers=cap_headers
        ))
        if final_status["status"] != "failed":
            raise RuntimeError(f"Unexpected final order status: {final_status}")
        print("LEASE_FENCING_AND_MANUAL_RESOLUTION=OK")

        checked(owner.post(
            f"/api/v3/devices/{device_id}/revoke", headers=owner_headers
        ))
        print("DEVICE_REVOCATION=OK")
        print("LIVE_VERTICAL_SLICE=PASS")
    finally:
        try:
            db.rollback()
            if app_user_id:
                with db.cursor() as cursor:
                    cursor.execute(
                        "UPDATE autoprint_v3.print_jobs SET approved_by_user_id = NULL WHERE approved_by_user_id = %s",
                        (app_user_id,),
                    )
                    cursor.execute(
                        "DELETE FROM autoprint_v3.device_enrollment_codes WHERE created_by_user_id = %s",
                        (app_user_id,),
                    )
                    cursor.execute(
                        "DELETE FROM autoprint_v3.users WHERE id = %s",
                        (app_user_id,),
                    )
                db.commit()
        finally:
            db.close()
        if auth_user_id:
            response = admin.delete(f"/auth/v1/admin/users/{auth_user_id}")
            if not response.is_success:
                print(f"WARNING_AUTH_CLEANUP_HTTP={response.status_code}")
        admin.close()


if __name__ == "__main__":
    main()
