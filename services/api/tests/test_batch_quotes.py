from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.capabilities import hash_capability_token
from app.main import app


RULES = {
    "bw_simplex_slabs": [{"min_pages": 1, "max_pages": 9999, "rate": 2}],
    "bw_duplex_slabs": [{"min_pages": 1, "max_pages": 9999, "rate": 1.5}],
    "color_simplex_slabs": [{"min_pages": 1, "max_pages": 9999, "rate": 10}],
    "color_duplex_slabs": [{"min_pages": 1, "max_pages": 9999, "rate": 8}],
}


class Query:
    def __init__(self, client, table): self.client = client; self.table = table; self.filters = {}
    def select(self, *_args, **_kwargs): return self
    def eq(self, key, value): self.filters[key] = value; return self
    def gt(self, *_args): return self
    def is_(self, *_args): return self
    def order(self, *_args, **_kwargs): return self
    def limit(self, *_args): return self
    def execute(self):
        if self.table == "orders": return SimpleNamespace(data=[self.client.order])
        if self.table == "rate_cards": return SimpleNamespace(data=[self.client.rate_card])
        if self.table == "print_artifacts":
            return SimpleNamespace(data=[self.client.artifacts[self.filters["source_document_id"]]])
        raise AssertionError(f"Unexpected table: {self.table}")


class FakeClient:
    def __init__(self, document_count):
        documents = [{"id": f"doc-{index}", "original_file_name": f"{chr(64 + index)}.pdf"} for index in range(1, document_count + 1)]
        self.order = {"id": "order-1", "shop_id": "shop-1", "source_documents": documents}
        pages = [2, 4, 1]
        self.artifacts = {document["id"]: {"id": f"artifact-{index}", "source_document_id": document["id"], "sha256": f"sha-{index}", "logical_page_count": pages[index - 1]} for index, document in enumerate(documents, 1)}
        self.rate_card = {"id": "rate-1", "version": 7, "rules_json": RULES}
        self.rpc_name = None; self.rpc_args = None
    def table(self, name): return Query(self, name)
    def rpc(self, name, args):
        self.rpc_name = name; self.rpc_args = args
        items = [{"quote_item_id": f"item-{index}", **line} for index, line in enumerate(args["p_items"], 1)]
        return SimpleNamespace(execute=lambda: SimpleNamespace(data={"quote_id": "quote-1", "items": items}))


def _headers(): return {"X-AutoPrint-Capability": "batch-capability"}


def test_single_document_creates_one_authoritative_quote_item():
    fake = FakeClient(1)
    payload = {"items": [{"source_document_id": "doc-1", "options": {"copies": 2, "color_mode": "bw", "duplex": False}}]}
    with patch("app.routes.quotes.get_supabase_client", return_value=fake), patch("app.routes.quotes.hash_capability_token", return_value="cap-hash"):
        response = TestClient(app).post("/api/v3/orders/order-1/quotes", headers=_headers(), json=payload)
    assert response.status_code == 200
    assert len(response.json()["items"]) == 1
    assert fake.rpc_name == "create_batch_price_quote"
    assert fake.rpc_args["p_items"][0]["artifact_id"] == "artifact-1"
    assert fake.rpc_args["p_items"][0]["artifact_sha256"] == "sha-1"


def test_three_documents_keep_line_settings_and_total():
    fake = FakeClient(3)
    options = [
        {"copies": 2, "color_mode": "bw", "duplex": False},
        {"copies": 1, "color_mode": "color", "duplex": True},
        {"copies": 3, "color_mode": "bw", "duplex": False},
    ]
    payload = {"items": [{"source_document_id": f"doc-{index}", "options": value} for index, value in enumerate(options, 1)]}
    with patch("app.routes.quotes.get_supabase_client", return_value=fake), patch("app.routes.quotes.hash_capability_token", return_value="cap-hash"):
        response = TestClient(app).post("/api/v3/orders/order-1/quotes", headers=_headers(), json=payload)
    assert response.status_code == 200
    assert response.json()["total_amount"] == 46.0
    assert [line["options_json"] for line in fake.rpc_args["p_items"]] == options
    assert [line["artifact_id"] for line in fake.rpc_args["p_items"]] == ["artifact-1", "artifact-2", "artifact-3"]


def test_batch_migration_guards_three_jobs_against_duplicate_acceptance():
    sql = (Path(__file__).parents[1] / "migrations" / "0023_batch_quote_items.sql").read_text(encoding="utf-8")
    completion = (Path(__file__).parents[1] / "migrations" / "0024_complete_batch_quote_pipeline.sql").read_text(encoding="utf-8")
    assert "ON CONFLICT (quote_item_id)" in sql
    assert "print_jobs_quote_unique" in completion and "DROP CONSTRAINT" in completion
    assert "v_item.options_json" in completion and "v_item.options_hash" in completion


def test_acceptance_retry_reuses_idempotency_identity_and_batch_rpc():
    capability = "batch-capability"
    quote = {
        "id": "quote-1", "price_quote_items": [{"id": "item-1"}, {"id": "item-2"}, {"id": "item-3"}],
        "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat(),
        "orders": {"capability_hash": hash_capability_token(capability), "expires_at": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()},
    }
    class AcceptClient:
        def __init__(self): self.calls = []
        def table(self, _name):
            class AcceptQuery:
                def select(self, *_args): return self
                def eq(self, *_args): return self
                def execute(self): return SimpleNamespace(data=[quote])
            return AcceptQuery()
        def rpc(self, name, args):
            self.calls.append((name, args))
            return SimpleNamespace(execute=lambda: SimpleNamespace(data={"status": "accepted", "job_ids": ["job-1", "job-2", "job-3"]}))
    database = AcceptClient(); headers = {"X-AutoPrint-Capability": capability, "Idempotency-Key": "retry-after-timeout"}
    with patch("app.routes.quotes.get_supabase_client", return_value=database):
        first = TestClient(app).post("/api/v3/quotes/quote-1/accept", headers=headers)
        second = TestClient(app).post("/api/v3/quotes/quote-1/accept", headers=headers)
    assert first.json()["job_ids"] == second.json()["job_ids"] == ["job-1", "job-2", "job-3"]
    assert [call[0] for call in database.calls] == ["accept_batch_quote", "accept_batch_quote"]
    assert database.calls[0][1]["p_idempotency_key_hash"] == database.calls[1][1]["p_idempotency_key_hash"]
