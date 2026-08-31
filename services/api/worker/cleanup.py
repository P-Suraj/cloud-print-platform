import argparse
import logging
import sys
import time
from app.db import get_worker_supabase_client
from app.settings import settings

logger = logging.getLogger("cleanup")


def _delete_storage_object(client, object_path: str) -> bool:
    """
    Attempt to delete a single object from Storage.
    Returns True on success, False on failure (error is logged, NOT swallowed).
    """
    try:
        client.storage.from_(settings.storage_bucket).remove([object_path])
        return True
    except Exception as exc:
        logger.error(
            "Storage delete FAILED for '%s': %s — row will NOT be marked deleted",
            object_path, exc
        )
        return False


def process_storage_cleanup_once(dry_run: bool = False) -> int:
    """
    Find expired, unprotected storage objects and delete them from Storage + DB.

    Safety predicates applied to BOTH source_documents AND print_artifacts:
      1. cleanup_status = 'pending'
      2. retention_until < now()          — hard expiry must have passed
      3. No active print_jobs referencing the object (status NOT IN terminal states)

    Only if Storage deletion succeeds is the DB row marked 'deleted'.
    Returns the number of rows successfully cleaned.
    """
    client = get_worker_supabase_client()
    deleted_count = 0
    now_str = time.strftime('%Y-%m-%d %H:%M:%S+00', time.gmtime())

    # ----- 1. Source documents -----
    # Fetch candidates: pending + retention expired
    src_res = client.table("source_documents").select("*").eq(
        "cleanup_status", "pending"
    ).lt("retention_until", now_str).limit(20).execute()

    for doc in (src_res.data or []):
        doc_id = doc["id"]
        order_id = doc.get("order_id")

        # Safety check: are there any non-terminal print_jobs that reference
        # an artifact derived from this source document?
        live_jobs_res = client.table("print_jobs").select("id").eq(
            "order_id", order_id
        ).not_.in_("status", ["completed", "rejected", "failed", "cancelled"]).execute()

        if live_jobs_res.data:
            logger.warning(
                "Skipping source_document %s — live job(s) found: %s",
                doc_id, [j["id"] for j in live_jobs_res.data]
            )
            continue

        object_path = doc.get("object_path")
        if dry_run:
            logger.info("[DRY RUN] Would delete source_document %s path=%s", doc_id, object_path)
            deleted_count += 1
            continue

        if object_path:
            if not _delete_storage_object(client, object_path):
                continue  # Do NOT mark deleted if Storage delete failed

        client.table("source_documents").update({
            "cleanup_status": "deleted",
            "deleted_at": now_str,
            "delete_error": None,
        }).eq("id", doc_id).execute()
        deleted_count += 1
        logger.info("Cleaned source_document %s path=%s", doc_id, object_path)

    # ----- 2. Print artifacts -----
    art_res = client.table("print_artifacts").select("*").eq(
        "cleanup_status", "pending"
    ).lt("retention_until", now_str).limit(20).execute()

    for art in (art_res.data or []):
        art_id = art["id"]

        # Safety check: any live print_job referencing this artifact?
        live_jobs_res = client.table("print_jobs").select("id").eq(
            "artifact_id", art_id
        ).not_.in_("status", ["completed", "rejected", "failed", "cancelled"]).execute()

        if live_jobs_res.data:
            logger.warning(
                "Skipping print_artifact %s — live job(s) found: %s",
                art_id, [j["id"] for j in live_jobs_res.data]
            )
            continue

        object_path = art.get("object_path")
        if dry_run:
            logger.info("[DRY RUN] Would delete print_artifact %s path=%s", art_id, object_path)
            deleted_count += 1
            continue

        if object_path:
            if not _delete_storage_object(client, object_path):
                continue  # Do NOT mark deleted if Storage delete failed

        client.table("print_artifacts").update({
            "cleanup_status": "deleted",
            "deleted_at": now_str,
            "delete_error": None,
        }).eq("id", art_id).execute()
        deleted_count += 1
        logger.info("Cleaned print_artifact %s path=%s", art_id, object_path)

    return deleted_count


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

    parser = argparse.ArgumentParser(
        description="AutoPrint v3 Storage Retention Cleanup Worker"
    )
    parser.add_argument("--once", action="store_true", help="Process cleanup once and exit")
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Log what would be deleted without actually deleting"
    )
    args = parser.parse_args()

    if args.dry_run:
        logger.info("[CLEANUP] DRY RUN mode — no deletions will be performed")

    logger.info("[CLEANUP] Starting AutoPrint v3 storage retention cleanup worker...")

    if args.once or args.dry_run:
        count = process_storage_cleanup_once(dry_run=args.dry_run)
        verb = "Would clean" if args.dry_run else "Cleaned"
        logger.info("[CLEANUP] %s %d expired storage item(s).", verb, count)
        sys.exit(0)

    logger.info("[CLEANUP] Running continuous retention cleanup daemon...")
    try:
        while True:
            process_storage_cleanup_once()
            time.sleep(300)  # Every 5 minutes
    except KeyboardInterrupt:
        logger.info("[CLEANUP] Cleanup worker stopped by operator.")


if __name__ == "__main__":
    main()
