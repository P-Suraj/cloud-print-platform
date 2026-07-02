import os
import sys
import logging
import tempfile

import config
from print_executor import SimulationPrintExecutor, SumatraPDFPrintExecutor

# Set up logging for CLI run
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("PrintAgent.TestPrint")

# Minimal PDF bytes for the test page containing "AutoPrint Test Page" text
TEST_PDF_BYTES = (
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
    b"<< /Length 75 >>\n"
    b"stream\n"
    b"BT /F1 16 Tf 72 712 Td (AutoPrint Test Page) Tj ET\n"
    b"BT /F1 12 Tf 72 680 Td (Printer configured successfully.) Tj ET\n"
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
    b"348\n"
    b"%%EOF"
)

def print_test_page(printer_name: str) -> tuple:
    """
    Writes a temporary PDF and prints it silently to the specified printer queue.
    Returns (success_boolean, error_message_or_none).
    """
    logger.info(f"Initiating test print to printer: '{printer_name}'")
    
    # 1. Create temporary PDF file
    temp_dir = config.TEMP_DIR
    os.makedirs(temp_dir, exist_ok=True)
    
    temp_fd, temp_path = tempfile.mkstemp(suffix="_autoprint_test.pdf", dir=temp_dir)
    try:
        with os.fdopen(temp_fd, "wb") as tmp:
            tmp.write(TEST_PDF_BYTES)
        
        # 2. Select correct executor
        if config.SIMULATION_MODE:
            logger.info("Running test print in SIMULATION mode.")
            executor = SimulationPrintExecutor()
        else:
            logger.info(f"Running test print in REAL mode via: {config.SUMATRA_EXE}")
            executor = SumatraPDFPrintExecutor(config.SUMATRA_EXE)
            
        # 3. Print the file
        options = {
            "copies": 1,
            "duplex": False,
            "color_mode": "bw"
        }
        success, error_msg = executor.print_file(temp_path, printer_name, options)
        
        if success:
            logger.info("Test print job successfully submitted.")
            return True, None
        else:
            logger.error(f"Test print failed: {error_msg}")
            return False, error_msg
            
    except Exception as e:
        logger.exception("An exception occurred during test printing")
        return False, str(e)
    finally:
        # 4. Always clean up temporary file
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception as e:
                logger.warning(f"Failed to delete temp test file '{temp_path}': {e}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python test_print.py <printer_name>")
        sys.exit(1)
    
    target_printer = sys.argv[1]
    success, err = print_test_page(target_printer)
    if success:
        print("SUCCESS: Test page successfully spooled/simulated!")
        sys.exit(0)
    else:
        print(f"FAILED: {err}")
        sys.exit(1)
