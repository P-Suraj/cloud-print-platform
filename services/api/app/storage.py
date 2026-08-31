from app.db import get_supabase_client, get_worker_supabase_client
from app.settings import settings

def check_storage_health() -> bool:
    """Readiness check for Storage dependency."""
    try:
        client = get_supabase_client()
        buckets = client.storage.list_buckets()
        return True
    except Exception:
        return False

def generate_signed_upload_url(object_path: str):
    """Generate temporary signed upload URL for object path under private bucket."""
    client = get_supabase_client()
    bucket = client.storage.from_(settings.storage_bucket)
    res = bucket.create_signed_upload_url(object_path)
    return res

def generate_signed_download_url(
    object_path: str,
    expires_in_seconds: int = 900,
    *,
    for_worker: bool = False,
):
    """Generate temporary signed viewing/download URL for object path."""
    client = get_worker_supabase_client() if for_worker else get_supabase_client()
    bucket = client.storage.from_(settings.storage_bucket)
    res = bucket.create_signed_url(object_path, expires_in_seconds)
    if isinstance(res, dict) and "signedURL" in res and "signed_url" not in res:
        res = {**res, "signed_url": res["signedURL"]}
    return res
