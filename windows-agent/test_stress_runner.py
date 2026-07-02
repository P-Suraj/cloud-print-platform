import os
import sys
import uuid
import time
import logging
from supabase import create_client, Client

import config

# Setup logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] StressRunner: %(message)s")
logger = logging.getLogger("StressRunner")

# Valid minimal PDF bytes
MINIMAL_PDF_BYTES = (
    b"%PDF-1.4\n"
    b"1 0 obj\n"
    b"<< /Type /Catalog /Pages 2 0 R >>\n"
    b"endobj\n"
    b"2 0 obj\n"
    b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>\n"
    b"endobj\n"
    b"3 0 obj\n"
    b"<< /Type /Page /Parent 2 0 R /Resources << >> /MediaBox [0 0 595 842] /Contents 4 0 R >>\n"
    b"endobj\n"
    b"4 0 obj\n"
    b"<< /Length 60 >>\n"
    b"stream\n"
    b"BT /F1 12 Tf 72 712 Td (AutoPrint Stress Test Document) Tj ET\n"
    b"endstream\n"
    b"endobj\n"
    b"xref\n"
    b"0 5\n"
    b"0000000000 65535 f\n"
    b"0000000009 00000 n\n"
    b"0000000058 00000 n\n"
    b"0000000115 00000 n\n"
    b"0000000222 00000 n\n"
    b"trailer\n"
    b"<< /Size 5 /Root 1 0 R >>\n"
    b"startxref\n"
    b"333\n"
    b"%%EOF"
)

# Invalid/Corrupt PDF bytes
CORRUPT_PDF_BYTES = b"INVALID_PDF_FILE_HEADER_CORRUPTED_BYTES_1234567890"

def generate_multi_page_pdf(pages: int) -> bytes:
    """Generates a pseudo-multipaged PDF by appending page object streams to test spooling delays."""
    content = bytearray(MINIMAL_PDF_BYTES)
    # Append padding to simulate multi-page load size
    content.extend(b"\n% Padding to test larger files \n" + (b"X" * 50000 * pages))
    return bytes(content)

def main():
    logger.info("=========================================")
    logger.info("     AutoPrint Stress Test Runner        ")
    logger.info("=========================================")

    # Initialize Supabase client
    try:
        supabase: Client = create_client(config.SUPABASE_URL, config.SUPABASE_KEY)
        logger.info("Supabase connection successfully established.")
    except Exception as e:
        logger.critical(f"Failed to connect to Supabase: {e}")
        sys.exit(1)

    jobs_to_track = []
    
    # Define test jobs list
    # Format: (type, content_bytes, description)
    test_jobs = []
    
    # 1. 10 x Small PDFs
    for i in range(10):
        test_jobs.append(("small", MINIMAL_PDF_BYTES, f"small_job_{i+1}.pdf"))
        
    # 2. 5 x Medium Image PDFs (padding 1MB size)
    for i in range(5):
        test_jobs.append(("medium", generate_multi_page_pdf(5), f"medium_image_job_{i+1}.pdf"))
        
    # 3. 5 x Multi-page PDFs (padding 3MB size)
    for i in range(5):
        test_jobs.append(("large", generate_multi_page_pdf(15), f"large_multipage_job_{i+1}.pdf"))
        
    # 4. 2 x Corrupt PDFs
    for i in range(2):
        test_jobs.append(("corrupt", CORRUPT_PDF_BYTES, f"corrupted_job_{i+1}.pdf"))

    logger.info(f"Queuing total of {len(test_jobs)} print jobs to Supabase Storage and DB...")
    
    for idx, (j_type, content, filename) in enumerate(test_jobs):
        job_id = str(uuid.uuid4())
        storage_path = f"stress_{job_id}_{filename}"
        
        try:
            # A. Upload file to storage
            supabase.storage.from_(config.SUPABASE_BUCKET).upload(
                path=storage_path,
                file=content,
                file_options={"content-type": "application/pdf" if j_type != "corrupt" else "text/plain"}
            )
            
            # B. Insert DB job record
            job_data = {
                "id": job_id,
                "shop_id": config.SHOP_ID,
                "file_path": storage_path,
                "file_name": filename,
                "copies": 1,
                "duplex": False,
                "color_mode": "bw",
                "status": "queued"
            }
            supabase.table("print_jobs").insert(job_data).execute()
            
            jobs_to_track.append({
                "id": job_id,
                "name": filename,
                "type": j_type,
                "status": "queued",
                "storage_path": storage_path
            })
            logger.info(f"[{idx+1}/{len(test_jobs)}] Queued {j_type} job: '{filename}'")
        except Exception as e:
            logger.error(f"Failed to queue job '{filename}': {e}")

    logger.info("-----------------------------------------")
    logger.info("All jobs queued. Beginning real-time queue monitoring...")
    logger.info("Start your AutoPrint agent to begin execution.")
    logger.info("-----------------------------------------")

    # Monitor loop
    start_time = time.time()
    all_completed = False
    
    while not all_completed:
        time.sleep(5)
        
        # Check active statuses
        completed_count = 0
        failed_count = 0
        active_count = 0
        
        try:
            for job in jobs_to_track:
                if job["status"] not in ["completed", "failed"]:
                    # Fetch latest status from DB
                    res = supabase.table("print_jobs").select("status", "error").eq("id", job["id"]).execute()
                    if res.data:
                        job["status"] = res.data[0]["status"]
                        job["error"] = res.data[0].get("error")
                        
                if job["status"] == "completed":
                    completed_count += 1
                elif job["status"] == "failed":
                    failed_count += 1
                else:
                    active_count += 1
            
            logger.info(f"Monitoring: Completed: {completed_count} | Failed: {failed_count} | Active: {active_count}")
            
            if active_count == 0:
                all_completed = True
                logger.info("All jobs have reached a terminal state.")
                
        except Exception as e:
            logger.error(f"Error querying job statuses: {e}")
            
        # Hard limit timeout of 5 minutes to prevent infinite loops
        if time.time() - start_time > 300:
            logger.warning("Timeout reached (5 minutes). Exiting stress test monitor.")
            break

    # Summary Report
    elapsed = time.time() - start_time
    logger.info("=========================================")
    logger.info("          STRESS TEST SUMMARY            ")
    logger.info("=========================================")
    logger.info(f"Total duration: {elapsed:.2f} seconds")
    
    successful_runs = 0
    clean_corrupt_fails = 0
    other_failures = 0
    
    for job in jobs_to_track:
        if job["type"] == "corrupt":
            if job["status"] == "failed":
                clean_corrupt_fails += 1
                logger.info(f"✓ [FAIL-CLEAN] Corrupt job '{job['name']}' failed cleanly. Error: {job.get('error')}")
            else:
                logger.error(f"❌ [RISK] Corrupt job '{job['name']}' was marked '{job['status']}' instead of failing!")
        else:
            if job["status"] == "completed":
                successful_runs += 1
            else:
                other_failures += 1
                logger.error(f"❌ [FAIL] Valid job '{job['name']}' failed with error: {job.get('error')}")

    logger.info(f"Successful runs: {successful_runs}/{len(test_jobs) - 2} valid jobs.")
    logger.info(f"Clean failure runs: {clean_corrupt_fails}/2 corrupt jobs.")
    
    # ── Clean up storage files to prevent bloat ──
    logger.info("Cleaning up stress test files from Supabase Storage...")
    for job in jobs_to_track:
        try:
            supabase.storage.from_(config.SUPABASE_BUCKET).remove([job["storage_path"]])
        except Exception as e:
            logger.warning(f"Failed to delete storage file '{job['storage_path']}': {e}")
    logger.info("Storage cleanup complete.")
    logger.info("=========================================")

if __name__ == "__main__":
    main()
