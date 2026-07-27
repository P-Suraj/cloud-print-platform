import os
import sys
import time
import shutil
import logging
from logging.handlers import RotatingFileHandler
import signal
import threading
import win32event
import win32api
import winerror

import config
import config_manager
from queue_listener import LocalFolderQueueListener
from print_executor import SimulationPrintExecutor, SumatraPDFPrintExecutor
from tray_app import SystemTrayApp
from printer_manager import check_printer_queue_status

# ── Logging Setup with Rotation ─────────────────
# Log limit: 5MB, backups kept: 3
logger = logging.getLogger("PrintAgent")
logger.setLevel(logging.INFO)

formatter = logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")

# Console Stream Handler
stream_handler = logging.StreamHandler(sys.stdout)
stream_handler.setFormatter(formatter)
logger.addHandler(stream_handler)

# Ensure config logs directory exists
os.makedirs(os.path.dirname(config.LOG_FILE), exist_ok=True)

# Rotating File Handler
file_handler = RotatingFileHandler(config.LOG_FILE, maxBytes=5*1024*1024, backupCount=3, encoding='utf-8')
file_handler.setFormatter(formatter)
logger.addHandler(file_handler)


def convert_word_to_pdf(docx_path, pdf_path) -> int:
    """
    Converts a .doc or .docx file to a PDF using MS Word COM interface.
    Returns the resolved page count of the converted document.
    """
    import pythoncom
    import win32com.client
    
    # Initialize COM for the current thread
    pythoncom.CoInitialize()
    word = None
    doc = None
    try:
        word = win32com.client.Dispatch("Word.Application")
        word.AutomationSecurity = 3  # msoAutomationSecurityForceDisable = 3
        word.Visible = False
        
        # Open the Word document
        doc = word.Documents.Open(docx_path)
        
        # Save as PDF (wdFormatPDF = 17)
        doc.SaveAs(pdf_path, FileFormat=17)
        
        # Calculate page count (wdStatisticPages = 2)
        page_count = doc.ComputeStatistics(2)
        
        doc.Close(SaveChanges=False)
        word.Quit()
        return max(1, page_count)
    except Exception as e:
        logger.error(f"Error converting Word document '{docx_path}' to PDF: {e}")
        if doc:
            try:
                doc.Close(SaveChanges=False)
            except Exception:
                pass
        if word:
            try:
                word.Quit()
            except Exception:
                pass
        raise e
    finally:
        pythoncom.CoUninitialize()

def convert_image_to_pdf(image_path, pdf_path):
    """
    Converts a standard image format to a single-page PDF.
    """
    from PIL import Image
    try:
        img = Image.open(image_path)
        # Convert to RGB mode if necessary (standard PDF does not support RGBA transparency)
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")
        img.save(pdf_path, "PDF")
    except Exception as e:
        logger.error(f"Error converting image '{image_path}' to PDF: {e}")
        raise e

def apply_nup_layout(input_pdf_path, output_pdf_path, n) -> int:
    """
    Combines 'n' pages from input PDF onto a single sheet of A4 in the output PDF.
    n can be 2, 4, 6, 9, 16.
    Returns the resolved page count of the compiled N-up PDF.
    """
    from pypdf import PdfReader, PdfWriter, PageObject, Transformation
    reader = PdfReader(input_pdf_path)
    writer = PdfWriter()
    
    # Standard A4 size: 595 x 842 points (portrait)
    sheet_w = 595
    sheet_h = 842
    
    # Grid sizes based on N
    if n == 2:
        # For 2-up, we use landscape sheet (842 x 595) to place them side-by-side
        sheet_w, sheet_h = 842, 595
        cols, rows = 2, 1
    elif n == 4:
        cols, rows = 2, 2
    elif n == 6:
        cols, rows = 2, 3
    elif n == 9:
        cols, rows = 3, 3
    elif n == 16:
        cols, rows = 4, 4
    else:
        # Default fallback
        cols, rows = 1, 1
        
    cell_w = sheet_w / cols
    cell_h = sheet_h / rows
    
    num_pages = len(reader.pages)
    current_page_idx = 0
    
    while current_page_idx < num_pages:
        sheet = PageObject.create_blank_page(width=sheet_w, height=sheet_h)
        
        for r in range(rows):
            for c in range(cols):
                if current_page_idx >= num_pages:
                    break
                
                input_page = reader.pages[current_page_idx]
                
                orig_w = float(input_page.mediabox.width)
                orig_h = float(input_page.mediabox.height)
                
                scale_x = cell_w / orig_w
                scale_y = cell_h / orig_h
                scale = min(scale_x, scale_y)
                
                fitted_w = orig_w * scale
                fitted_h = orig_h * scale
                
                # Grid positioning (left-to-right, top-to-bottom)
                x_offset = c * cell_w + (cell_w - fitted_w) / 2
                y_offset = (rows - 1 - r) * cell_h + (cell_h - fitted_h) / 2
                
                trans = Transformation().scale(scale, scale).translate(x_offset, y_offset)
                
                # Create a temporary page to apply the transformation
                temp_page = PageObject.create_blank_page(width=sheet_w, height=sheet_h)
                temp_page.merge_page(input_page)
                temp_page.add_transformation(trans)
                
                sheet.merge_page(temp_page)
                current_page_idx += 1
                
        writer.add_page(sheet)
        
    with open(output_pdf_path, "wb") as f:
        writer.write(f)
        
    return len(writer.pages)

def stitch_id_cards_to_pdf(front_img_path, back_img_path, pdf_path):
    """
    Stitches front and back ID card images vertically on a single A4 sheet.
    Resizes them to standard ID card proportions and pastes them centered on the page.
    """
    from PIL import Image, ImageDraw
    # Disable pixels limit to prevent decompression bomb error on large uploads
    Image.MAX_IMAGE_PIXELS = None
    try:
        # A4 canvas size at 300 DPI: 2480 x 3508 pixels
        canvas_w = 2480
        canvas_h = 3508
        canvas = Image.new("RGB", (canvas_w, canvas_h), (255, 255, 255))
        
        # ID Card dimensions: approx 8.5 cm x 5.5 cm -> 1000 x 650 pixels
        target_w = 1000
        target_h = 650
        
        # Load and resize front image
        img_front = Image.open(front_img_path)
        img_front = img_front.resize((target_w, target_h), Image.Resampling.LANCZOS)
        
        # Load and resize back image
        img_back = Image.open(back_img_path)
        img_back = img_back.resize((target_w, target_h), Image.Resampling.LANCZOS)
        
        # Centered paste offsets
        x_offset = (canvas_w - target_w) // 2
        y_offset_front = int(canvas_h * 0.25) - (target_h // 2)
        y_offset_back = int(canvas_h * 0.65) - (target_h // 2)
        
        # Paste
        canvas.paste(img_front, (x_offset, y_offset_front))
        canvas.paste(img_back, (x_offset, y_offset_back))
        
        # Draw borders
        draw = ImageDraw.Draw(canvas)
        border_color = (200, 200, 200)
        draw.rectangle([x_offset, y_offset_front, x_offset + target_w, y_offset_front + target_h], outline=border_color, width=4)
        draw.rectangle([x_offset, y_offset_back, x_offset + target_w, y_offset_back + target_h], outline=border_color, width=4)
        
        canvas.save(pdf_path, "PDF")
        return True
    except Exception as e:
        logger.error(f"Failed to stitch ID card images to PDF: {e}")
        raise e

def stitch_photo_grid_to_pdf(image_paths, pdf_path, n):
    """
    Stitches multiple images into a grid on a single A4 PDF.
    n can be 2, 4, 6, 9, 16.
    """
    from PIL import Image, ImageDraw
    import math
    # Disable pixels limit to prevent decompression bomb error
    Image.MAX_IMAGE_PIXELS = None
    
    # A4 standard size at 300 DPI: 2480 x 3508 pixels
    canvas_w = 2480
    canvas_h = 3508
    
    # Grid sizing
    if n == 2:
        cols, rows = 1, 2
    elif n == 4:
        cols, rows = 2, 2
    elif n == 6:
        cols, rows = 2, 3
    elif n == 9:
        cols, rows = 3, 3
    elif n == 16:
        cols, rows = 4, 4
    else:
        cols, rows = 2, 2
        
    cell_w = canvas_w // cols
    cell_h = canvas_h // rows
    
    per_sheet = cols * rows
    num_sheets = math.ceil(len(image_paths) / per_sheet)
    
    canvases = []
    
    for sheet_idx in range(num_sheets):
        # Create canvas for this sheet
        canvas = Image.new("RGB", (canvas_w, canvas_h), (255, 255, 255))
        draw = ImageDraw.Draw(canvas)
        border_color = (220, 220, 220)
        
        start_idx = sheet_idx * per_sheet
        end_idx = min(start_idx + per_sheet, len(image_paths))
        
        for idx in range(start_idx, end_idx):
            img_path = image_paths[idx]
            if not img_path or not os.path.exists(img_path):
                continue
                
            try:
                img = Image.open(img_path)
                # Calculate grid position relative to this sheet
                grid_pos = idx - start_idx
                c = grid_pos % cols
                r = grid_pos // cols
                
                # Target box inside the cell (with 40px padding)
                pad = 40
                box_w = cell_w - (pad * 2)
                box_h = cell_h - (pad * 2)
                
                # Maintain aspect ratio
                orig_w, orig_h = img.size
                scale = min(box_w / orig_w, box_h / orig_h)
                fit_w = int(orig_w * scale)
                fit_h = int(orig_h * scale)
                
                # Resize
                img_resized = img.resize((fit_w, fit_h), Image.Resampling.LANCZOS)
                
                # Position centered in cell
                x_offset = c * cell_w + (cell_w - fit_w) // 2
                y_offset = r * cell_h + (cell_h - fit_h) // 2
                
                # Paste
                canvas.paste(img_resized, (x_offset, y_offset))
                
                # Draw thin border around the image
                draw.rectangle(
                    [x_offset, y_offset, x_offset + fit_w, y_offset + fit_h],
                    outline=border_color,
                    width=3
                )
            except Exception as e:
                logger.warning(f"Failed to grid image index {idx}: {e}")
                
        canvases.append(canvas)
        
    if canvases:
        canvases[0].save(pdf_path, "PDF", save_all=True, append_images=canvases[1:])
    return len(canvases)

# Global mutex handle to prevent garbage collection
agent_mutex = None

def acquire_agent_mutex():
    """Ensures only a single background agent can run at any time."""
    global agent_mutex
    try:
        agent_mutex = win32event.CreateMutex(None, True, "Local\\AutoPrintAgentMutex")
        if win32api.GetLastError() == winerror.ERROR_ALREADY_EXISTS:
            logger.info("Another AutoPrintAgent process is already running. Exiting.")
            sys.exit(0)
    except Exception as e:
        logger.warning(f"Failed to acquire agent mutex: {e}")

def setup_shutdown_listener(agent_instance):
    """Listens for the named local shutdown event to trigger graceful process termination."""
    def listener():
        # Create manual-reset Win32 Event
        event = win32event.CreateEvent(None, True, False, "Local\\AutoPrintShutdownEvent")
        while agent_instance.keep_running:
            # Check event status every 1000ms
            result = win32event.WaitForSingleObject(event, 1000)
            if result == win32event.WAIT_OBJECT_0:
                logger.info("Win32 Shutdown event signaled. Triggering clean exit...")
                # Reset event for future installations
                win32event.ResetEvent(event)
                agent_instance.shutdown()
                break
    threading.Thread(target=listener, daemon=True).start()

class PrintAgent:
    def __init__(self):
        self.keep_running = True
        self.is_paused = False
        self.target_printer = ""
        self.target_printer_bw = ""
        self.target_printer_color = ""
        self.tray = None
        
    def handle_shutdown(self, signum, frame):
        logger.info("Shutdown signal received. Stopping agent...")
        self.shutdown()

    def set_paused(self, is_paused: bool):
        self.is_paused = is_paused
        logger.info(f"Agent polling state updated: {'PAUSED' if is_paused else 'RUNNING'}")

    def reload_printer_config(self):
        """Reloads the target printer name from the LocalAppData configuration."""
        old_printer = self.target_printer
        self.target_printer = config_manager.get_selected_printer()
        if not self.target_printer:
            self.target_printer = config.get_default_printer()
            
        self.target_printer_bw = config_manager.get_bw_printer()
        if not self.target_printer_bw:
            self.target_printer_bw = self.target_printer
            
        self.target_printer_color = config_manager.get_color_printer()
        if not self.target_printer_color:
            self.target_printer_color = self.target_printer
            
        logger.info(f"Target printers reloaded - B&W: '{self.target_printer_bw}', Color: '{self.target_printer_color}' (was '{old_printer}')")

    def shutdown(self):
        self.keep_running = False
        logger.info("Agent process exit flagged.")

    def run(self):
        logger.info("=========================================")
        logger.info("    AutoPrint Windows Agent Starting     ")
        logger.info("=========================================")
        
        # Load local configuration
        self.reload_printer_config()
        
        logger.info(f"Mode: {'SIMULATION' if config.SIMULATION_MODE else 'REAL PRINTER'}")
        logger.info(f"Queue Type: {'CLOUD (Supabase)' if config.USE_CLOUD_QUEUE else 'LOCAL FOLDER'}")
        logger.info(f"Default Target Printer: {self.target_printer}")
        
        # Ensure Temp Directory exists and is clean on startup
        if os.path.exists(config.TEMP_DIR):
            logger.info(f"Purging startup temp directory: {config.TEMP_DIR}")
            for item in os.listdir(config.TEMP_DIR):
                item_path = os.path.join(config.TEMP_DIR, item)
                try:
                    if os.path.isfile(item_path) or os.path.islink(item_path):
                        os.unlink(item_path)
                    elif os.path.isdir(item_path):
                        shutil.rmtree(item_path)
                except Exception as e:
                    logger.warning(f"Failed to delete startup temp item {item_path}: {e}")

        # 1. Initialize Queue Listener
        listener = None
        if config.USE_CLOUD_QUEUE:
            try:
                from supabase_queue_listener import SupabaseQueueListener
                listener = SupabaseQueueListener()
                
                # Log agent_online telemetry event
                listener.log_event("agent_online")
                
                # Startup Recovery: Mark stuck 'processing' or 'printing' jobs
                logger.info("Running startup recovery check for stuck cloud jobs...")
                import datetime
                from printer_manager import is_job_in_spooler
                stuck_jobs_response = listener.client.table("print_jobs").select("id").eq("shop_id", config.SHOP_ID).in_("status", ["processing", "printing"]).execute()
                stuck_jobs = stuck_jobs_response.data
                failed_recovered = 0
                completed_recovered = 0
                if stuck_jobs:
                    for job in stuck_jobs:
                        jid = job["id"]
                        if config_manager.is_job_printed_locally(jid):
                            # Mark as completed since we know it printed locally
                            listener.client.table("print_jobs").update({
                                "status": "completed",
                                "updated_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
                            }).eq("id", jid).execute()
                            completed_recovered += 1
                            logger.info(f"Recovery: Job {jid} was already printed locally. Marking completed.")
                        elif is_job_in_spooler(self.target_printer, jid):
                            # Mark as completed since the spooler already has it and is printing it
                            listener.client.table("print_jobs").update({
                                "status": "completed",
                                "updated_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
                            }).eq("id", jid).execute()
                            completed_recovered += 1
                        else:
                            # Re-verify/Fail job so user knows it did not print and can retry
                            listener.client.table("print_jobs").update({
                                "status": "failed",
                                "error": "Agent Restart Recovery (Unspooled crash recovery)",
                                "updated_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
                            }).eq("id", jid).execute()
                            failed_recovered += 1
                if (failed_recovered + completed_recovered) > 0:
                    logger.info(f"Recovery complete. Completed (spooled): {completed_recovered}, Failed (unspooled): {failed_recovered}.")
                else:
                    logger.info("No stuck jobs found.")
            except Exception as e:
                logger.error(f"Failed to initialize SupabaseQueueListener or run recovery: {e}")
        else:
            listener = LocalFolderQueueListener(config.WATCH_DIR)

        # 2. Initialize Print Executor
        if config.SIMULATION_MODE:
            executor = SimulationPrintExecutor()
        else:
            executor = SumatraPDFPrintExecutor(config.SUMATRA_EXE)

        # 3. Boot System Tray Application
        self.tray = SystemTrayApp(agent_instance=self)
        self.tray.run()

        current_interval = config.POLL_INTERVAL
        consecutive_idle_polls = 0
        printer_check_counter = 0
        last_heartbeat_time = 0.0

        # Set initial tray status
        if listener is None:
            self.tray.set_status("red")
        else:
            self.tray.set_status("green")

        # 4. Start named shutdown listener thread
        setup_shutdown_listener(self)

        # 5. Main Polling Loop
        while self.keep_running:
            # Handle paused state
            if self.is_paused:
                time.sleep(1.0)
                continue
                
            if listener is None:
                # Retry listener initialization if it previously failed
                logger.info("Retrying Supabase listener connection...")
                try:
                    from supabase_queue_listener import SupabaseQueueListener
                    listener = SupabaseQueueListener()
                    self.tray.set_status("green")
                    logger.info("Supabase listener connected successfully on retry.")
                    # Log agent_online telemetry event
                    listener.log_event("agent_online")
                except Exception:
                    self.tray.set_status("red")
                    time.sleep(10.0)
                    continue

            # 5a. Periodic Printer Spooler State Health Check (Every ~30 seconds)
            # 15 cycles * 2.0s poll interval = ~30s
            printer_check_counter += 1
            if printer_check_counter >= 15:
                printer_check_counter = 0
                logger.info(f"Running periodic health check on printer '{self.target_printer}'...")
                p_status = check_printer_queue_status(self.target_printer)
                if p_status["status"] == "error":
                    logger.warning(f"Printer spooler reported errors: {p_status['errors']}")
                    self.tray.set_status("red")
                else:
                    self.tray.set_status("green")

            # 5b. Send Agent Heartbeat (Every ~20 seconds)
            current_time = time.time()
            if current_time - last_heartbeat_time >= 20.0:
                last_heartbeat_time = current_time
                if config.USE_CLOUD_QUEUE and listener is not None:
                    listener.send_heartbeat(bw_printer=self.target_printer_bw, color_printer=self.target_printer_color)
                    # Retry any storage deletions that failed previously (network timeout etc.)
                    if hasattr(listener, "retry_pending_deletions"):
                        listener.retry_pending_deletions()

            try:
                job = listener.poll_for_next_job()
                
                if job:
                    consecutive_idle_polls = 0
                    current_interval = config.POLL_INTERVAL
                    job_id = job.get("id")
                    file_path = job.get("file_path", "")
                    file_name = job.get("file_name") or os.path.basename(file_path) or f"{job_id}.pdf"
                    
                    logger.info(f"\n[JOB {job_id}] Found job: '{file_name}'")
                    
                    # Update tray status to "blue" (printing/active)
                    self.tray.set_status("blue")
                    
                    # Update status to 'processing'
                    listener.update_job_status(job_id, "processing")
                    
                    # Download or resolve local source files/images
                    temp_files_to_clean = []
                    layout_mode = job.get("layout_mode", "document")
                    download_success = False
                    
                    temp_source_path = None
                    temp_pdf_path = None
                    local_page_count = job.get("page_count")

                    if layout_mode == "id_card":
                        # Aadhaar / ID Card Stitching mode
                        front_storage_path = job.get("file_path")
                        back_storage_path = front_storage_path.replace("_front", "_back")
                        
                        _, front_ext = os.path.splitext(front_storage_path)
                        temp_front_path = os.path.join(config.TEMP_DIR, f"{job_id}_front{front_ext}")
                        temp_files_to_clean.append(temp_front_path)
                        
                        _, back_ext = os.path.splitext(back_storage_path)
                        temp_back_path = os.path.join(config.TEMP_DIR, f"{job_id}_back{back_ext}")
                        temp_files_to_clean.append(temp_back_path)
                        
                        temp_pdf_path = os.path.join(config.TEMP_DIR, f"{job_id}_stitched.pdf")
                        temp_files_to_clean.append(temp_pdf_path)
                        
                        if config.USE_CLOUD_QUEUE:
                            logger.info(f"[JOB {job_id}] ID Card layout mode. Retrieving front: '{front_storage_path}' and back: '{back_storage_path}'...")
                            try:
                                listener.download_file(front_storage_path, temp_front_path)
                                
                                # Download back file, with extension fallback
                                try:
                                    listener.download_file(back_storage_path, temp_back_path)
                                except Exception as back_err:
                                    logger.info(f"[JOB {job_id}] Back image download failed with derived path, trying alternate extensions...")
                                    downloaded_back = False
                                    base_back = back_storage_path.rsplit('.', 1)[0]
                                    for ext in ['.jpg', '.jpeg', '.png', '.webp', '.PNG', '.JPG', '.JPEG']:
                                        alt_back_storage_path = f"{base_back}{ext}"
                                        alt_temp_back_path = os.path.join(config.TEMP_DIR, f"{job_id}_back{ext}")
                                        try:
                                            listener.download_file(alt_back_storage_path, alt_temp_back_path)
                                            # Update path & clean list
                                            temp_files_to_clean.remove(temp_back_path)
                                            temp_back_path = alt_temp_back_path
                                            temp_files_to_clean.append(temp_back_path)
                                            downloaded_back = True
                                            break
                                        except Exception:
                                            continue
                                    if not downloaded_back:
                                        raise back_err
                                        
                                download_success = True
                            except Exception as e:
                                error_msg = f"Failed to retrieve ID card files: {str(e)}"
                                logger.error(error_msg)
                                listener.update_job_status(job_id, "failed", error_msg)
                                self.tray.set_status("green")
                                # Clean up whatever got downloaded
                                for p in temp_files_to_clean:
                                    if os.path.exists(p):
                                        try: os.remove(p)
                                        except Exception: pass
                                continue
                        else:
                            # Local file resolution
                            front_source_path = front_storage_path
                            if not os.path.isabs(front_source_path):
                                front_source_path = os.path.join(config.WATCH_DIR, front_source_path)
                                
                            back_source_path = front_source_path.replace("_front", "_back")
                            
                            if not os.path.exists(front_source_path):
                                error_msg = f"Front ID card file not found at: {front_source_path}"
                                logger.error(error_msg)
                                listener.update_job_status(job_id, "failed", error_msg)
                                self.tray.set_status("green")
                                continue
                                
                            # Check back file with fallback extensions
                            if not os.path.exists(back_source_path):
                                base_back = back_source_path.rsplit('.', 1)[0]
                                found_back = False
                                for ext in ['.jpg', '.jpeg', '.png', '.webp', '.PNG', '.JPG', '.JPEG']:
                                    alt_back = f"{base_back}{ext}"
                                    if os.path.exists(alt_back):
                                        back_source_path = alt_back
                                        # Update path & clean list
                                        temp_files_to_clean.remove(temp_back_path)
                                        temp_back_path = os.path.join(config.TEMP_DIR, f"{job_id}_back{ext}")
                                        temp_files_to_clean.append(temp_back_path)
                                        found_back = True
                                        break
                                if not found_back:
                                    error_msg = f"Back ID card file not found. Expected near: {back_source_path}"
                                    logger.error(error_msg)
                                    listener.update_job_status(job_id, "failed", error_msg)
                                    self.tray.set_status("green")
                                    continue
                                    
                            try:
                                shutil.copy2(front_source_path, temp_front_path)
                                shutil.copy2(back_source_path, temp_back_path)
                                download_success = True
                            except Exception as e:
                                error_msg = f"Failed to isolate ID card files: {str(e)}"
                                logger.error(error_msg)
                                listener.update_job_status(job_id, "failed", error_msg)
                                self.tray.set_status("green")
                                continue
                                
                        if download_success:
                            try:
                                logger.info(f"[JOB {job_id}] Stitching front and back images to A4 PDF...")
                                stitch_id_cards_to_pdf(temp_front_path, temp_back_path, temp_pdf_path)
                                local_page_count = 1
                                logger.info(f"[JOB {job_id}] Stitched successfully to {temp_pdf_path}")
                            except Exception as e:
                                error_msg = f"ID Card stitching failed: {str(e)}"
                                logger.error(error_msg)
                                listener.update_job_status(job_id, "failed", error_msg)
                                self.tray.set_status("green")
                                # Cleanup downloaded images
                                for p in temp_files_to_clean:
                                    if os.path.exists(p):
                                        try: os.remove(p)
                                        except Exception: pass
                                continue
                    elif layout_mode == "photo_grid":
                        # Photo Grid layout mode
                        base_storage_path = job.get("file_path") # e.g. jobs/{jobId}_img_0.png
                        _, img_ext = os.path.splitext(base_storage_path)
                        if not img_ext:
                            img_ext = ".png" # default fallback
                            
                        grid_size = job.get("pages_per_sheet", 4)
                        temp_pdf_path = os.path.join(config.TEMP_DIR, f"{job_id}_grid.pdf")
                        temp_files_to_clean.append(temp_pdf_path)
                        
                        local_image_paths = []
                        download_count = 0
                        
                        # We try to download all uploaded images
                        idx = 0
                        while True:
                            if idx >= 16:
                                logger.info(f"[JOB {job_id}] Photo Grid download limit reached (16 images). Stopping download.")
                                break
                            # build storage path replacing _img_0 with _img_{idx}
                            storage_path = base_storage_path.replace("_img_0", f"_img_{idx}")
                            temp_img_path = os.path.join(config.TEMP_DIR, f"{job_id}_img_{idx}{img_ext}")
                            
                            if config.USE_CLOUD_QUEUE:
                                try:
                                    logger.info(f"[JOB {job_id}] Photo Grid mode. Downloading image {idx}: '{storage_path}'...")
                                    listener.download_file(storage_path, temp_img_path)
                                    temp_files_to_clean.append(temp_img_path)
                                    local_image_paths.append(temp_img_path)
                                    download_count += 1
                                    idx += 1
                                except Exception as img_err:
                                    if idx == 0:
                                        # First image is mandatory
                                        raise Exception(f"Failed to download initial grid image: {img_err}")
                                    else:
                                        # Other images are optional / end of sequence
                                        logger.info(f"[JOB {job_id}] No more images found for grid. Stopping at {idx}.")
                                        break
                            else:
                                # Local resolution
                                source_path = storage_path
                                if not os.path.isabs(source_path):
                                    source_path = os.path.join(config.WATCH_DIR, source_path)
                                    
                                if os.path.exists(source_path):
                                    try:
                                        shutil.copy2(source_path, temp_img_path)
                                        temp_files_to_clean.append(temp_img_path)
                                        local_image_paths.append(temp_img_path)
                                        download_count += 1
                                        idx += 1
                                    except Exception as copy_err:
                                        if idx == 0:
                                            raise Exception(f"Failed to copy initial grid image: {copy_err}")
                                        else:
                                            break
                                else:
                                    if idx == 0:
                                        raise Exception(f"Initial grid image not found at: {source_path}")
                                    else:
                                        break
                                        
                        if download_count > 0:
                            download_success = True
                            try:
                                logger.info(f"[JOB {job_id}] Stitching {download_count} images to grid PDF...")
                                local_page_count = stitch_photo_grid_to_pdf(local_image_paths, temp_pdf_path, grid_size)
                                logger.info(f"[JOB {job_id}] Grid stitched successfully to {temp_pdf_path}. Sheets: {local_page_count}")
                            except Exception as e:
                                error_msg = f"Photo Grid stitching failed: {str(e)}"
                                logger.error(error_msg)
                                listener.update_job_status(job_id, "failed", error_msg)
                                self.tray.set_status("green")
                                for p in temp_files_to_clean:
                                    if os.path.exists(p):
                                        try: os.remove(p)
                                        except Exception: pass
                                continue
                    else:
                        # Standard Document Mode
                        temp_source_path = os.path.join(config.TEMP_DIR, f"{job_id}_{file_name}")
                        temp_pdf_path = temp_source_path
                        temp_files_to_clean.append(temp_source_path)
                        temp_files_to_clean.append(temp_pdf_path)
                        
                        if config.USE_CLOUD_QUEUE:
                            pdf_storage_path = job.get("file_path")
                            logger.info(f"[JOB {job_id}] Retrieving file from Supabase Storage: '{pdf_storage_path}'...")
                            try:
                                listener.download_file(pdf_storage_path, temp_source_path)
                                download_success = True
                            except Exception as e:
                                error_msg = f"Failed to retrieve file from storage: {str(e)}"
                                logger.error(error_msg)
                                listener.update_job_status(job_id, "failed", error_msg)
                                self.tray.set_status("green")
                                continue
                        else:
                            source_path = job.get("file_path")
                            if not os.path.isabs(source_path):
                                source_path = os.path.join(config.WATCH_DIR, source_path)

                            if not os.path.exists(source_path):
                                error_msg = f"Source file not found at: {source_path}"
                                logger.error(error_msg)
                                listener.update_job_status(job_id, "failed", error_msg)
                                self.tray.set_status("green")
                                continue

                            # Copy file to TEMP_DIR to isolate print processing
                            try:
                                shutil.copy2(source_path, temp_source_path)
                                logger.info(f"[JOB {job_id}] Copied source file to isolated environment: {temp_source_path}")
                                download_success = True
                            except Exception as e:
                                error_msg = f"Failed to isolate file: {str(e)}"
                                logger.error(error_msg)
                                listener.update_job_status(job_id, "failed", error_msg)
                                self.tray.set_status("green")
                                continue

                        # Dynamic File Format Conversion to PDF
                        _, ext = os.path.splitext(file_name.lower())
                        conversion_needed = ext in [".docx", ".doc", ".png", ".jpg", ".jpeg", ".webp", ".gif"]
                        
                        if download_success and conversion_needed:
                            temp_pdf_path = temp_source_path + ".pdf"
                            temp_files_to_clean.append(temp_pdf_path)
                            try:
                                if ext in [".docx", ".doc"]:
                                    logger.info(f"[JOB {job_id}] Word document format detected. Converting to PDF...")
                                    local_page_count = convert_word_to_pdf(temp_source_path, temp_pdf_path)
                                    logger.info(f"[JOB {job_id}] Converted Word to PDF successfully. Pages: {local_page_count}")
                                elif ext in [".png", ".jpg", ".jpeg", ".webp", ".gif"]:
                                    logger.info(f"[JOB {job_id}] Image format detected. Converting to PDF...")
                                    convert_image_to_pdf(temp_source_path, temp_pdf_path)
                                    local_page_count = 1
                                    logger.info(f"[JOB {job_id}] Converted Image to PDF successfully. Pages: {local_page_count}")
                            except Exception as e:
                                error_msg = f"PDF Conversion failed: {str(e)}"
                                logger.error(error_msg)
                                listener.update_job_status(job_id, "failed", error_msg)
                                self.tray.set_status("green")
                                # Cleanup downloaded source
                                for p in temp_files_to_clean:
                                    if os.path.exists(p):
                                        try: os.remove(p)
                                        except Exception: pass
                                continue

                        # If N-Up is selected, compile the pages on a single sheet
                        pages_per_sheet = job.get("pages_per_sheet", 1)
                        if download_success and pages_per_sheet > 1:
                            logger.info(f"[JOB {job_id}] N-Up layout detected ({pages_per_sheet} pages per sheet). Compiling N-up PDF...")
                            try:
                                temp_nup_path = temp_pdf_path + "_nup.pdf"
                                temp_files_to_clean.append(temp_nup_path)
                                local_page_count = apply_nup_layout(temp_pdf_path, temp_nup_path, pages_per_sheet)
                                temp_pdf_path = temp_nup_path
                                logger.info(f"[JOB {job_id}] N-Up compilation completed. Pages: {local_page_count}")
                            except Exception as nup_err:
                                error_msg = f"N-Up Compilation failed: {str(nup_err)}"
                                logger.error(error_msg)
                                listener.update_job_status(job_id, "failed", error_msg)
                                self.tray.set_status("green")
                                for p in temp_files_to_clean:
                                    if os.path.exists(p):
                                        try: os.remove(p)
                                        except Exception: pass
                                continue

                    # Configure options
                    raw_copies = job.get("copies", 1)
                    try:
                        copies = max(1, min(int(raw_copies), 10))
                    except (ValueError, TypeError):
                        copies = 1

                    options = {
                        "copies": copies,
                        "duplex": job.get("duplex", False),
                        "color_mode": job.get("color_mode", "bw"),
                        "page_range": job.get("page_range"),
                        "orientation": job.get("orientation", "auto"),
                        "fit_mode": job.get("fit_mode", "fit"),
                        "paper_size": job.get("paper_size", "A4"),
                        "pages_per_sheet": job.get("pages_per_sheet", 1)
                    }
                    
                    # Determine active printer based on color mode routing
                    if job.get("color_mode") == "color":
                        active_printer = self.target_printer_color
                    else:
                        active_printer = self.target_printer_bw

                    # Pre-flight check: configured printer validation (only if not simulation mode)
                    printer_valid = True
                    if not config.SIMULATION_MODE:
                        try:
                            from printer_manager import enumerate_printers
                            system_printers = [p.lower() for p in enumerate_printers()]
                            if active_printer.lower() not in system_printers:
                                printer_valid = False
                                success, err_msg = False, f"Configured printer not found: '{active_printer}'"
                                logger.error(f"[JOB {job_id}] {err_msg}")
                        except Exception as pe:
                            logger.warning(f"[JOB {job_id}] Failed to verify system printers list: {pe}")

                    # Pre-flight check: downloaded file validation
                    file_valid = False
                    if printer_valid:
                        if not temp_pdf_path or not os.path.exists(temp_pdf_path):
                            success, err_msg = False, "Target PDF file does not exist on disk."
                            logger.error(f"[JOB {job_id}] print pre-flight failed: {err_msg}")
                        elif os.path.getsize(temp_pdf_path) == 0:
                            success, err_msg = False, "Target PDF file is empty (0 bytes)."
                            logger.error(f"[JOB {job_id}] print pre-flight failed: {err_msg}")
                        elif not temp_pdf_path.lower().endswith(".pdf"):
                            success, err_msg = False, f"Target file has invalid format: expected .pdf, got '{os.path.splitext(temp_pdf_path)[1]}'"
                            logger.error(f"[JOB {job_id}] print pre-flight failed: {err_msg}")
                        else:
                            file_valid = True

                    if printer_valid and file_valid:
                        # Execute silent print
                        logger.info(f"[JOB {job_id}] Spooling job to printer '{active_printer}'...")
                        success, err_msg = executor.print_file(temp_pdf_path, active_printer, options)

                    # Clean up temporary files immediately
                    for path_to_clean in set(temp_files_to_clean):
                        if path_to_clean and os.path.exists(path_to_clean):
                            try:
                                os.remove(path_to_clean)
                                logger.info(f"[JOB {job_id}] Purged file: {path_to_clean}")
                            except Exception as e:
                                logger.warning(f"[JOB {job_id}] Failed to delete file '{path_to_clean}': {e}")
                                
                    # Supplementary cleanup to remove any other files starting with job_id in TEMP_DIR
                    try:
                        for filename in os.listdir(config.TEMP_DIR):
                            if filename.startswith(str(job_id)):
                                file_p = os.path.join(config.TEMP_DIR, filename)
                                if os.path.exists(file_p):
                                    try:
                                        os.remove(file_p)
                                        logger.info(f"[JOB {job_id}] Supplementary purged: {file_p}")
                                    except Exception:
                                        pass
                    except Exception as clean_err:
                        logger.warning(f"[JOB {job_id}] Supplementary cleanup failed: {clean_err}")

                    # Update final job status
                    if success:
                        config_manager.add_printed_job(job_id)
                        listener.update_job_status(job_id, "completed", page_count=local_page_count, file_path=file_path)
                        logger.info(f"[JOB {job_id}] Job processed successfully.")
                        
                        # Delete original source file (local queue only)
                        if not config.USE_CLOUD_QUEUE:
                            if layout_mode == "id_card":
                                for path in [front_source_path, back_source_path]:
                                    if path and os.path.exists(path):
                                        try:
                                            os.remove(path)
                                            logger.info(f"[JOB {job_id}] Purged source file: {path}")
                                        except Exception as e:
                                            logger.warning(f"[JOB {job_id}] Failed to delete source file '{path}': {e}")
                            else:
                                if os.path.exists(source_path):
                                    try:
                                        os.remove(source_path)
                                        logger.info(f"[JOB {job_id}] Purged source file: {source_path}")
                                    except Exception as e:
                                        logger.warning(f"[JOB {job_id}] Failed to delete source file: {e}")
                    else:
                        listener.update_job_status(job_id, "failed", err_msg)
                        logger.error(f"[JOB {job_id}] Job failed: {err_msg}")
                    
                    # Reset tray status to Green
                    self.tray.set_status("green")
                    
                    # Rest the CPU (using adaptive interval)
                    time.sleep(current_interval)
                else:
                    # Reset status to Green just in case it was Red previously
                    self.tray.set_status("green")
                    
                    consecutive_idle_polls += 1
                    if consecutive_idle_polls >= 3:
                        current_interval = 10.0 # back off to 10s if idle
                    else:
                        current_interval = config.POLL_INTERVAL
                    time.sleep(current_interval)
                
            except Exception as e:
                logger.error(f"Unexpected connection error occurred in polling loop: {e}")
                self.tray.set_status("red")
                
                # Active sleep-wake connection recovery handshake
                if listener is not None and config.USE_CLOUD_QUEUE:
                    logger.info("Initiating connection recovery handshake...")
                    try:
                        time.sleep(5.0) # Grace period
                        listener.reconnect()
                        self.tray.set_status("green")
                        logger.info("Handshake recovery succeeded. Resuming polling.")
                        # Log agent_online telemetry event
                        listener.log_event("agent_online")
                    except Exception as reconnect_err:
                        logger.error(f"Handshake recovery failed: {reconnect_err}. Retrying on next loop.")
                
                time.sleep(config.POLL_INTERVAL)

        logger.info("Agent stopped clean.")
        if config.USE_CLOUD_QUEUE and listener is not None:
            try:
                listener.log_event("agent_offline")
            except Exception as offline_err:
                logger.warning(f"Failed to log agent_offline during clean shutdown: {offline_err}")

        if self.tray and self.tray.icon:
            try:
                self.tray.icon.stop()
            except Exception:
                pass

if __name__ == "__main__":
    # Acquire agent Named Mutex to prevent duplicate processes
    acquire_agent_mutex()

    agent = PrintAgent()
    
    # Register signals for clean exit
    signal.signal(signal.SIGINT, agent.handle_shutdown)
    signal.signal(signal.SIGTERM, agent.handle_shutdown)
    
    agent.run()
