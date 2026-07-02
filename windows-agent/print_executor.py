import os
import time
import subprocess
import logging

class PrintExecutor:
    """
    Abstract Base Class for executing print commands.
    """
    def print_file(self, file_path, printer_name, options):
        raise NotImplementedError("Subclasses must implement print_file()")


import shutil

class SimulationPrintExecutor(PrintExecutor):
    """
    Mock print executor that logs options and simulates a printing process
    by copying the printed PDF file to a local 'printed_output' folder.
    """
    def __init__(self):
        self.logger = logging.getLogger("PrintAgent.SimulationExecutor")

    def print_file(self, file_path, printer_name, options):
        self.logger.info("Initializing print simulation...")
        self.logger.info(f"Target file: {os.path.basename(file_path)}")
        self.logger.info(f"Target printer: {printer_name}")
        self.logger.info(f"Print options: {options}")

        # Simulate spooling delay
        time.sleep(3.0)

        # Output the printed PDF to a mock output folder to verify the result on disk
        try:
            output_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "printed_output")
            os.makedirs(output_dir, exist_ok=True)
            output_filename = f"printed_{int(time.time())}_{os.path.basename(file_path)}"
            output_path = os.path.join(output_dir, output_filename)
            shutil.copy2(file_path, output_path)
            self.logger.info(f"Mock printed file saved to disk at: {output_path}")
        except Exception as e:
            self.logger.warning(f"Failed to copy file to mock printed output folder: {e}")

        self.logger.info("Simulation completed successfully.")
        return True, None


class SumatraPDFPrintExecutor(PrintExecutor):
    """
    Prints PDFs silently using SumatraPDF.exe.
    """
    def __init__(self, sumatra_exe_path):
        self.sumatra_exe_path = sumatra_exe_path
        self.logger = logging.getLogger("PrintAgent.SumatraExecutor")

    def print_file(self, file_path, printer_name, options):
        if not os.path.exists(self.sumatra_exe_path):
            error_msg = f"SumatraPDF executable not found at: {self.sumatra_exe_path}"
            self.logger.error(error_msg)
            return False, error_msg

        if not os.path.exists(file_path):
            error_msg = f"File to print not found: {file_path}"
            self.logger.error(error_msg)
            return False, error_msg

        # Construct print settings string
        # SumatraPDF documentation: -print-settings "copies,color_or_mono,duplex_mode"
        settings_list = []
        
        # Copies
        copies = options.get("copies", 1)
        settings_list.append(f"{copies}x")
        
        # Color Mode
        color_mode = options.get("color_mode", "bw")
        if color_mode == "color":
            settings_list.append("color")
        else:
            settings_list.append("monochrome")
            
        # Duplex Mode
        duplex = options.get("duplex", False)
        if duplex:
            settings_list.append("duplexlong")
        else:
            settings_list.append("simplex")

        # Sizing and scaling
        fit_mode = options.get("fit_mode", "fit")
        if fit_mode in ["fit", "shrink", "noscale"]:
            settings_list.append(fit_mode)
        else:
            settings_list.append("fit")

        # Orientation
        orientation = options.get("orientation", "auto")
        if orientation in ["portrait", "landscape"]:
            settings_list.append(orientation)

        # Paper Size
        paper_size = options.get("paper_size", "A4")
        if paper_size:
            settings_list.append(f"paper={paper_size.lower()}")

        # Page range
        page_range = options.get("page_range")
        if page_range:
            # Clean page range value (only digits, commas, and hyphens)
            import re
            cleaned_range = re.sub(r'[^0-9,-]', '', str(page_range))
            if cleaned_range:
                settings_list.append(cleaned_range)

        settings_str = ",".join(settings_list)

        cmd = [
            self.sumatra_exe_path,
            "-print-to", printer_name,
            "-print-settings", settings_str,
            file_path
        ]

        self.logger.info(f"Executing: {' '.join(cmd)}")

        try:
            # Configure subprocess flags to run silently without spawning a terminal popup
            startupinfo = None
            if os.name == 'nt':
                startupinfo = subprocess.STARTUPINFO()
                startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
                startupinfo.wShowWindow = 0 # SW_HIDE

            process = subprocess.Popen(
                cmd,
                startupinfo=startupinfo,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE
            )
            
            try:
                stdout, stderr = process.communicate(timeout=90)
            except subprocess.TimeoutExpired:
                process.kill()
                stdout, stderr = process.communicate()
                return False, "SumatraPDF process execution timed out (90 second limit exceeded)."

            return_code = process.returncode
            
            if return_code == 0:
                self.logger.info("SumatraPDF silent print job submitted to Windows spooler.")
                return True, None
            else:
                error_details = stderr.decode('utf-8', errors='ignore').strip() or f"Exit code {return_code}"
                self.logger.error(f"SumatraPDF failed with details: {error_details}")
                return False, f"SumatraPDF error: {error_details}"
                
        except Exception as e:
            self.logger.exception("Exception occurred during SumatraPDF process execution")
            return False, f"Process execution failed: {str(e)}"
