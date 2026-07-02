import json
import uuid
import config
import os

# A minimal, syntactically valid single-page A4 PDF file structure
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
    b"<< /Length 50 >>\n"
    b"stream\n"
    b"BT /F1 12 Tf 72 712 Td (AutoPrint Real-time Test) Tj ET\n"
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
    b"323\n"
    b"%%EOF"
)

def trigger_test_job():
    job_id = str(uuid.uuid4())[:8]
    pdf_filename = f"test_{job_id}.pdf"
    json_filename = f"job_{job_id}.json"

    pdf_filepath = os.path.join(config.WATCH_DIR, pdf_filename)
    json_filepath = os.path.join(config.WATCH_DIR, json_filename)

    # 1. Write the minimal PDF file
    with open(pdf_filepath, 'wb') as f:
        f.write(MINIMAL_PDF_BYTES)

    # 2. Write the JSON job file
    job_data = {
        "id": job_id,
        "file_name": pdf_filename,
        "file_path": pdf_filename,  # relative to WATCH_DIR
        "copies": 2,
        "duplex": True,
        "color_mode": "bw",
        "status": "queued"
    }

    with open(json_filepath, 'w', encoding='utf-8') as f:
        json.dump(job_data, f, indent=2)

    print("=========================================")
    print("    Mock Print Job Created Successfully  ")
    print("=========================================")
    print(f"Job ID:      {job_id}")
    print(f"PDF File:    {pdf_filename}")
    print(f"JSON Config: {json_filename}")
    print(f"Folder:      {config.WATCH_DIR}")
    print("-----------------------------------------")
    print("Watching the agent log to see execution...")

if __name__ == "__main__":
    trigger_test_job()
