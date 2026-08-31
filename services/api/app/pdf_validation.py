import io
import pypdf
import multiprocessing
from typing import Tuple

def validate_pdf_bytes(file_bytes: bytes) -> Tuple[bool, int, str]:
    """
    Validate raw PDF bytes using pypdf 6.13.2.
    Returns: (is_valid: bool, page_count: int, error_message: str)
    """
    if not file_bytes:
        return False, 0, "Empty document bytes"

    # Check magic header
    if not file_bytes.startswith(b"%PDF-"):
        return False, 0, "File does not start with valid PDF magic header %PDF-"
    if b"/JavaScript" in file_bytes or b"/JS" in file_bytes:
        return False, 0, "PDF contains embedded JavaScript actions"

    try:
        reader = pypdf.PdfReader(io.BytesIO(file_bytes), strict=True)

        if reader.is_encrypted:
            return False, 0, "Encrypted or password-protected PDF files are not allowed"

        num_pages = len(reader.pages)
        if num_pages <= 0:
            return False, 0, "PDF document contains 0 logical pages"

        return True, num_pages, ""

    except Exception as e:
        return False, 0, f"Malformed PDF document: {str(e)}"


def _validation_child(file_bytes: bytes, connection) -> None:
    try:
        connection.send(validate_pdf_bytes(file_bytes))
    finally:
        connection.close()


def validate_pdf_bytes_bounded(file_bytes: bytes, timeout_seconds: int = 10) -> Tuple[bool, int, str]:
    """Parse untrusted PDFs outside the API process with a hard wall-clock limit."""
    context = multiprocessing.get_context("spawn")
    parent, child = context.Pipe(duplex=False)
    process = context.Process(target=_validation_child, args=(file_bytes, child), daemon=True)
    process.start()
    child.close()
    try:
        if not parent.poll(timeout_seconds):
            process.terminate()
            process.join(timeout=2)
            return False, 0, "PDF validation timed out"
        return parent.recv()
    except EOFError:
        return False, 0, "PDF validation process failed"
    finally:
        parent.close()
        if process.is_alive():
            process.terminate()
        process.join(timeout=2)
