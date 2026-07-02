import sys
import os
import uuid
from supabase import create_client, Client
import config
from test_trigger import MINIMAL_PDF_BYTES

def trigger_cloud_job(file_path_arg=None):
    job_id = str(uuid.uuid4())
    
    # Initialize Supabase client
    supabase: Client = create_client(config.SUPABASE_URL, config.SUPABASE_KEY)

    print("=========================================")
    print("    Creating Mock Cloud Print Job...    ")
    print("=========================================")

    if file_path_arg:
        if os.path.exists(file_path_arg):
            pdf_filename = os.path.basename(file_path_arg)
            # Upload local file to Supabase Storage
            print(f"Uploading local file '{file_path_arg}' to Supabase Storage...")
            with open(file_path_arg, 'rb') as f:
                supabase.storage.from_(config.SUPABASE_BUCKET).upload(
                    path=pdf_filename,
                    file=f,
                    file_options={"content-type": "application/pdf"}
                )
            target_path = pdf_filename
        else:
            target_path = file_path_arg
            print(f"Using custom storage path: '{target_path}'")
    else:
        # Generate a local test PDF inside WATCH_DIR and upload it
        pdf_filename = f"cloud_test_{job_id}.pdf"
        local_path = os.path.join(config.WATCH_DIR, pdf_filename)
        with open(local_path, 'wb') as f:
            f.write(MINIMAL_PDF_BYTES)
        print(f"Generated local test PDF: '{local_path}'")
        
        print("Uploading test PDF to Supabase Storage...")
        with open(local_path, 'rb') as f:
            supabase.storage.from_(config.SUPABASE_BUCKET).upload(
                path=pdf_filename,
                file=f,
                file_options={"content-type": "application/pdf"}
            )
        target_path = pdf_filename
        
        # Clean up the local PDF so we verify the agent downloads it from the cloud
        try:
            os.remove(local_path)
            print(f"Cleaned up local trigger PDF: {local_path}")
        except Exception as e:
            print(f"Failed to delete local trigger PDF: {e}")

    # Write the job document in database with simplified schema
    job_data = {
        "id": job_id,
        "shop_id": config.SHOP_ID,
        "file_path": target_path,
        "file_name": os.path.basename(target_path),
        "status": "queued",
        "copies": 1,
        "page_count": 1
     }

    supabase.table("print_jobs").insert(job_data).execute()
    print(f"Created Supabase Database Row: print_jobs with ID {job_id}")
    print("-----------------------------------------")
    print("Job successfully queued in Supabase!")
    print("Watch the agent console/logs for processing...")
    print("=========================================")

if __name__ == "__main__":
    uri = sys.argv[1] if len(sys.argv) > 1 else None
    trigger_cloud_job(uri)
