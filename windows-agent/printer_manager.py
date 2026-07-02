import sys
import logging

logger = logging.getLogger("PrintAgent.PrinterManager")

def enumerate_printers() -> list:
    """
    Queries the local Windows system for all installed print queues
    (both physical local printers and network-connected print shares).
    Falls back to mock list if win32print is unavailable.
    """
    try:
        import win32print
        # EnumPrinters flags:
        # PRINTER_ENUM_LOCAL: Local printers
        # PRINTER_ENUM_CONNECTIONS: Network-connected printers
        printers_info = win32print.EnumPrinters(
            win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS
        )
        printers = [info[2] for info in printers_info]
        logger.info(f"Discovered printers: {printers}")
        return printers
    except ImportError:
        logger.warning("win32print module not found. Falling back to mock printers.")
        return ["Simulation Mock HP LaserJet M402", "Simulation Mock Canon LBP2900", "Simulation Mock Epson L805"]
    except Exception as e:
        logger.error(f"Error enumerating printers: {e}")
        return ["Simulation Mock Default Printer"]

def check_printer_queue_status(printer_name: str) -> dict:
    """
    Queries the Windows print spooler for details on active jobs 
    and hardware status of the target print queue.
    """
    status_summary = {"status": "idle", "jobs_count": 0, "errors": []}
    try:
        import win32print
        h_printer = win32print.OpenPrinter(printer_name)
        try:
            # Check active jobs in print queue
            jobs = win32print.EnumJobs(h_printer, 0, 99, 1)
            status_summary["jobs_count"] = len(jobs)
            
            # Check printer status properties
            printer_info = win32print.GetPrinter(h_printer, 2)
            status_flag = printer_info.get("Status", 0)
            
            if status_flag & win32print.PRINTER_STATUS_OFFLINE:
                status_summary["errors"].append("Offline")
            if status_flag & win32print.PRINTER_STATUS_PAPER_OUT:
                status_summary["errors"].append("Paper Out")
            if status_flag & win32print.PRINTER_STATUS_PAPER_JAM:
                status_summary["errors"].append("Paper Jam")
            if status_flag & win32print.PRINTER_STATUS_PAUSED:
                status_summary["errors"].append("Paused")
                
            if status_summary["errors"]:
                status_summary["status"] = "error"
            elif len(jobs) > 0:
                status_summary["status"] = "busy"
        finally:
            win32print.ClosePrinter(h_printer)
    except ImportError:
        # Fallback for dev environment
        status_summary["status"] = "simulation"
    except Exception as e:
        status_summary["status"] = "error"
        status_summary["errors"].append(f"Failed to query printer spooler: {str(e)}")
        
    return status_summary

def is_job_in_spooler(printer_name: str, job_id: str) -> bool:
    """
    Scans active Windows spooler job document names for a match containing job_id.
    Ensures crash recovery doesn't cause duplicate print runs.
    """
    try:
        import win32print
        h_printer = win32print.OpenPrinter(printer_name)
        try:
            # EnumJobs flags: 1 refers to JOB_INFO_1 structure which contains pDocument
            jobs = win32print.EnumJobs(h_printer, 0, 99, 1)
            for job in jobs:
                document_name = job.get("pDocument", "")
                if document_name and job_id in document_name:
                    logger.info(f"Verified job {job_id} is already in spooler queue as: '{document_name}'")
                    return True
        finally:
            win32print.ClosePrinter(h_printer)
    except Exception as e:
        logger.warning(f"Error checking spooler for job {job_id}: {e}")
        
    return False
