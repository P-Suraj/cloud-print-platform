from typing import Optional, Dict
from app.db import get_worker_supabase_client

def claim_next_preparation_task(worker_id: str, lease_seconds: int = 120) -> Optional[dict]:
    """Claim next pending preparation task using DB RPC or query lock."""
    client = get_worker_supabase_client()
    res = client.rpc("claim_preparation_task", {
        "p_worker_id": worker_id,
        "p_lease_seconds": lease_seconds
    }).execute()
    if res.data and len(res.data) > 0:
        return res.data[0]
    return None

def attach_print_artifact(source_document_id: str, artifact_path: str, sha256: str, page_count: int, byte_size: int) -> dict:
    """Attach immutable print_artifacts record in DB."""
    client = get_worker_supabase_client()
    art_data = {
        "source_document_id": source_document_id,
        "object_path": artifact_path,
        "sha256": sha256,
        "preparation_version": 1,
        "renderer_name": "pypdf",
        "renderer_version": "6.13.2",
        "logical_page_count": page_count,
        "byte_size": byte_size,
        "cleanup_status": "pending"
    }
    res = client.table("print_artifacts").insert(art_data).execute()
    return res.data[0] if res.data else {}
