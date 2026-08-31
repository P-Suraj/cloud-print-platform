"""Live M1 vertical-slice verification through public HTTP contracts only.

Required environment variables:
  TEST_API_URL, TEST_SHOP_CODE, TEST_OWNER_EMAIL, TEST_OWNER_PASSWORD,
  TEST_DEVICE_ID, TEST_DEVICE_SECRET

The API and preparation worker must be running against the migrated canary
project. The test deliberately reports an uncertain device outcome and has the
operator resolve it as failed; it never fabricates physical print completion.
"""

import io
import json
import os
import time
import unittest
import urllib.error
import urllib.request
import uuid

from pypdf import PdfWriter


REQUIRED_ENV = (
    "TEST_API_URL", "TEST_SHOP_CODE", "TEST_OWNER_EMAIL", "TEST_OWNER_PASSWORD",
    "TEST_DEVICE_ID", "TEST_DEVICE_SECRET",
)
LIVE_CONFIGURED = all(os.environ.get(name) for name in REQUIRED_ENV)


def _pdf_bytes() -> bytes:
    output = io.BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=595, height=842)
    writer.write(output)
    return output.getvalue()


def _request(method: str, url: str, *, headers=None, payload=None, body=None):
    request_headers = {"X-AutoPrint-Contract-Version": "3", **(headers or {})}
    data = body
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        request_headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=request_headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            raw = response.read()
            return response.status, dict(response.headers), json.loads(raw or b"{}")
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        parsed = json.loads(raw or b"{}")
        raise AssertionError(f"{method} {url} returned {exc.code}: {parsed}") from exc


def _multipart_pdf(document: bytes):
    boundary = f"autoprint-{uuid.uuid4().hex}"
    body = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"cacheControl\"\r\n\r\n3600\r\n"
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"\"; filename=\"vertical-slice.pdf\"\r\n"
        "Content-Type: application/pdf\r\n\r\n"
    ).encode("utf-8") + document + f"\r\n--{boundary}--\r\n".encode("utf-8")
    return body, f"multipart/form-data; boundary={boundary}"


@unittest.skipUnless(LIVE_CONFIGURED, "live vertical-slice environment is not configured")
class TestVerticalSliceIntegration(unittest.TestCase):
    def test_full_http_vertical_slice(self):
        api = os.environ["TEST_API_URL"].rstrip("/")
        shop_code = os.environ["TEST_SHOP_CODE"]
        document = _pdf_bytes()

        _, _, order = _request("POST", f"{api}/api/v3/shops/{shop_code}/orders")
        order_id = order["order_id"]
        capability = order["capability_token"]
        cap_headers = {"X-AutoPrint-Capability": capability}

        _, _, intent = _request(
            "POST", f"{api}/api/v3/orders/{order_id}/upload-intent", headers=cap_headers,
            payload={"original_file_name": "vertical-slice.pdf", "declared_media_type": "application/pdf", "byte_size": len(document)},
        )
        multipart, content_type = _multipart_pdf(document)
        upload_req = urllib.request.Request(
            intent["signed_upload_url"], data=multipart,
            headers={"Content-Type": content_type, "x-upsert": "false"}, method="PUT",
        )
        with urllib.request.urlopen(upload_req, timeout=60) as upload_response:
            self.assertLess(upload_response.status, 300)

        _request(
            "POST", f"{api}/api/v3/orders/{order_id}/finalize-upload", headers=cap_headers,
            payload={"source_document_id": intent["source_document_id"]},
        )

        deadline = time.time() + 120
        while time.time() < deadline:
            _, _, details = _request("GET", f"{api}/api/v3/orders/{order_id}", headers=cap_headers)
            if details["order"]["status"] == "ready_for_approval":
                break
            time.sleep(2)
        else:
            self.fail("preparation worker did not make the order ready within 120 seconds")

        _, _, quote = _request(
            "POST", f"{api}/api/v3/orders/{order_id}/quotes", headers=cap_headers,
            payload={"options": {"copies": 1, "color_mode": "bw", "duplex": False}},
        )
        idem = str(uuid.uuid4())
        accept_headers = {**cap_headers, "Idempotency-Key": idem}
        _, _, accepted = _request("POST", f"{api}/api/v3/quotes/{quote['quote_id']}/accept", headers=accept_headers)
        _, _, replay = _request("POST", f"{api}/api/v3/quotes/{quote['quote_id']}/accept", headers=accept_headers)
        self.assertEqual(accepted["job_id"], replay["job_id"])
        job_id = accepted["job_id"]

        _, login_headers, login = _request(
            "POST", f"{api}/api/v3/auth/login",
            payload={"email": os.environ["TEST_OWNER_EMAIL"], "password": os.environ["TEST_OWNER_PASSWORD"]},
        )
        set_cookie = login_headers.get("Set-Cookie", "")
        session_token = set_cookie.split("autoprint_session=", 1)[1].split(";", 1)[0]
        owner_headers = {"Authorization": f"Bearer {session_token}", "X-AutoPrint-CSRF": login["csrf_token"]}
        _request("POST", f"{api}/api/v3/shop/jobs/{job_id}/approve", headers=owner_headers)

        device_headers = {
            "X-AutoPrint-Device-Id": os.environ["TEST_DEVICE_ID"],
            "X-AutoPrint-Device-Secret": os.environ["TEST_DEVICE_SECRET"],
        }
        _, _, claim = _request(
            "POST", f"{api}/api/v3/agent/jobs/claim", headers=device_headers,
            payload={"lease_seconds": 300},
        )
        self.assertEqual(claim["job_id"], job_id)
        _request(
            "POST", f"{api}/api/v3/agent/attempts/{claim['attempt_id']}/outcome", headers=device_headers,
            payload={
                "job_id": job_id, "fencing_token": claim["fencing_token"],
                "outcome_status": "needs_attention", "completion_source": None,
                "evidence_json": {"test": "no physical submission performed"},
            },
        )
        _request(
            "POST", f"{api}/api/v3/shop/jobs/{job_id}/resolve", headers=owner_headers,
            payload={"outcome_status": "failed", "reason": "Integration test: no paper submitted"},
        )
        _, _, final_status = _request("GET", f"{api}/api/v3/orders/{order_id}/status", headers=cap_headers)
        self.assertEqual(final_status["status"], "failed")


if __name__ == "__main__":
    unittest.main()
