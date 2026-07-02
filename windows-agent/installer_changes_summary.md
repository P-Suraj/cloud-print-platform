# AutoPrint Installer & Onboarding Setup - Complete Technical Summary

This document provides a single, comprehensive source of truth for all components, files, and architectural designs implemented for the AutoPrint Windows installer and onboarding wizard.

---

## 1. Architectural Overview

The AutoPrint Windows Installer is designed to provide a lightweight, zero-configuration setup for print shops:
1. **Low Privilege (`lowest`):** Installed entirely under `%LOCALAPPDATA%\Programs\AutoPrint` to run without requiring Windows User Account Control (UAC) admin prompts.
2. **Boot Autostart:** Automatically registers the background process in `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` to launch on system start.
3. **Smart Process Control (`launcher.py`):** Ensures that:
   - On the first installation, it automatically blocks and runs the **Setup Wizard** to configure the shop.
   - On subsequent runs, it checks for duplicate instances of the **Agent** to prevent multiple spoolers from polling the same print queues.
   - It runs the agent detached in the background.
4. **Onboarding Setup Wizard (`setup_wizard.py`):** A modern Tkinter GUI wizard guiding the user through:
   - Entering their shop code (e.g., `KRL004`) or pasting their setup URL.
   - Connecting to the Supabase backend to resolve the shop.
   - Enumerating local/network Windows printers.
   - Running a background-threaded test page print job (spooling validation) without freezing the UI.

---

## 2. Database Schema Migration

To support human-readable setup URLs (like `https://autoprint.in/setup/KRL004`), a `shop_code` field was added with indexing to ensure high-performance resolution.

*   **File Path**: [migration_v3.sql](file:///f:/Projects/Printer%20automation/migration_v3.sql)
*   **Action**: Executed on Supabase

```sql
-- 1. Add shop_code column to public.shops table
ALTER TABLE public.shops 
ADD COLUMN IF NOT EXISTS shop_code TEXT UNIQUE;

-- 2. Create index on shop_code for fast lookup resolution
CREATE INDEX IF NOT EXISTS idx_shops_shop_code ON public.shops(shop_code);

-- 3. Seed the default pilot shop with a test shop code 'KRL004'
UPDATE public.shops 
SET shop_code = 'KRL004' 
WHERE id = '1bb3cb6a-869d-4c30-85d0-59992d7250e7';
```

---

## 3. Configuration Management

Manages reading, merging, and writing settings to the local machine app data folder.

*   **File Path**: [config_manager.py](file:///f:/Projects/Printer%20automation/desktop-agent/config_manager.py)
*   **Action**: Created

```python
import os
import json

CONFIG_DIR = os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "AutoPrint")
CONFIG_PATH = os.path.join(CONFIG_DIR, "config.json")
CURRENT_VERSION = 1

def load_config() -> dict:
    """
    Loads configuration dictionary from %LocalAppData%\\AutoPrint\\config.json.
    Returns an empty dictionary if the file is missing or corrupt.
    """
    if not os.path.exists(CONFIG_PATH):
        return {}
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
            if not isinstance(data, dict):
                return {}
            return data
    except Exception:
        return {}

def save_config(config_data: dict) -> bool:
    """
    Saves the config dictionary to %LocalAppData%\\AutoPrint\\config.json.
    Ensures that the containing folder is created automatically and contains the version field.
    """
    try:
        os.makedirs(CONFIG_DIR, exist_ok=True)
        # Load existing config to merge it, ensuring we don't wipe other keys
        existing = load_config()
        existing.update(config_data)
        
        # Ensure version is present
        if "version" not in existing:
            existing["version"] = CURRENT_VERSION
            
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(existing, f, indent=4)
        return True
    except Exception:
        return False

def get_selected_printer() -> str:
    """Returns the configured printer name, or an empty string if not set."""
    return load_config().get("printer_name", "")

def is_first_run_completed() -> bool:
    """Returns True if the setup wizard has been run and completed, False otherwise."""
    return load_config().get("first_run_completed", False)
```

---

## 4. Shop Code / Setup URL Resolver

Parses the user's input (direct code `KRL004` or full setup link `https://autoprint.in/setup/KRL004`) and resolves it against the cloud database.

*   **File Path**: [shop_resolver.py](file:///f:/Projects/Printer%20automation/desktop-agent/shop_resolver.py)
*   **Action**: Created

```python
import re
import logging
from supabase import create_client, Client
import config

logger = logging.getLogger("PrintAgent.ShopResolver")

def extract_shop_code(input_str: str) -> str:
    """
    Extracts the shop code from a raw user input, which can either be 
    a direct code (e.g., KRL004) or a setup URL (e.g., https://autoprint.in/setup/KRL004).
    """
    if not input_str:
        return ""
        
    input_str = input_str.strip()
    url_pattern = r"(?:https?://)?(?:www\.)?autoprint\.in/setup/([A-Za-z0-9_-]+)"
    match = re.search(url_pattern, input_str, re.IGNORECASE)
    if match:
        return match.group(1)
    return input_str.strip("/")

def resolve_shop_code(shop_code: str) -> dict:
    """
    Queries Supabase to resolve the alphanumeric shop_code to the internal UUID and name.
    """
    if not shop_code:
        return {
            "success": False,
            "shop_id": None,
            "shop_name": None,
            "error": "Shop code cannot be empty."
        }
        
    try:
        client: Client = create_client(config.SUPABASE_URL, config.SUPABASE_KEY)
        response = client.table("shops") \
            .select("id, name, is_active") \
            .eq("shop_code", shop_code) \
            .execute()
            
        records = response.data
        if not records:
            return {
                "success": False,
                "shop_id": None,
                "shop_name": None,
                "error": f"Shop code '{shop_code}' not found."
            }
            
        shop = records[0]
        if not shop.get("is_active", True):
            return {
                "success": False,
                "shop_id": None,
                "shop_name": None,
                "error": f"Shop '{shop_code}' is currently inactive."
            }
            
        return {
            "success": True,
            "shop_id": shop["id"],
            "shop_name": shop["name"],
            "error": None
        }
    except Exception as e:
        logger.exception("Error occurred while querying Supabase for shop_code")
        return {
            "success": False,
            "shop_id": None,
            "shop_name": None,
            "error": f"Connection failed: {str(e)}"
        }
```

---

## 5. Process Launcher

Handles bootstrapping and process control logic. It runs on boot to orchestrate setup or start the background listener.

*   **File Path**: [launcher.py](file:///f:/Projects/Printer%20automation/desktop-agent/launcher.py)
*   **Action**: Created

```python
import os
import sys
import subprocess
import logging

import config_manager

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] Launcher: %(message)s")
logger = logging.getLogger("Launcher")

def is_frozen() -> bool:
    """Returns True if running as a compiled PyInstaller executable, False if script."""
    return getattr(sys, 'frozen', False)

def get_executable_paths() -> tuple:
    """
    Returns paths to (SetupWizard, Agent) executables or scripts 
    depending on whether running in frozen (compiled) or script mode.
    """
    base_dir = os.path.dirname(os.path.abspath(sys.executable if is_frozen() else __file__))
    
    if is_frozen():
        wizard_path = os.path.join(base_dir, "AutoPrintSetupWizard.exe")
        agent_path = os.path.join(base_dir, "AutoPrintAgent.exe")
        return [wizard_path], [agent_path]
    else:
        python_exe = sys.executable
        wizard_script = os.path.join(base_dir, "setup_wizard.py")
        agent_script = os.path.join(base_dir, "agent.py")
        return [python_exe, wizard_script], [python_exe, agent_script]

def is_process_running(process_name: str) -> bool:
    """
    Checks if there's a running process matching the executable name.
    Only applicable when running as compiled frozen binaries.
    """
    if not is_frozen():
        # In script mode, multiple python instances could be running; skip duplicate checks.
        return False
        
    try:
        # Check tasklist for running process
        output = subprocess.check_output('tasklist /FI "IMAGENAME eq ' + process_name + '"', shell=True)
        return process_name.lower().encode() in output.lower()
    except Exception as e:
        logger.warning(f"Failed to check if process {process_name} is running: {e}")
        return False

def main():
    logger.info("=========================================")
    logger.info("       AutoPrint Launcher Booting        ")
    logger.info("=========================================")
    
    # 1. Retrieve config and check setup state
    first_run_completed = config_manager.is_first_run_completed()
    wizard_cmd, agent_cmd = get_executable_paths()
    
    if not first_run_completed:
        logger.info("First-run configuration not found. Launching Setup Wizard...")
        try:
            # Run setup wizard synchronously, waiting for it to finish
            result = subprocess.run(wizard_cmd, check=True)
            if result.returncode != 0:
                logger.error(f"Setup Wizard exited with code {result.returncode}. Aborting launch.")
                sys.exit(result.returncode)
            
            # Refresh config check
            if not config_manager.is_first_run_completed():
                logger.error("Setup Wizard finished but first_run_completed is still False. Aborting.")
                sys.exit(1)
            logger.info("Setup Wizard completed successfully. Proceeding to launch Agent.")
        except Exception as e:
            logger.exception(f"Failed to launch or run Setup Wizard: {e}")
            sys.exit(1)
            
    # 2. Check if agent is already running (to prevent launching duplicates on double-click)
    agent_executable_name = "AutoPrintAgent.exe"
    if is_frozen() and is_process_running(agent_executable_name):
        logger.info(f"Agent process '{agent_executable_name}' is already running. Exiting launcher.")
        sys.exit(0)
        
    # 3. Launch Agent in the background and terminate launcher
    logger.info(f"Launching AutoPrint Agent: {' '.join(agent_cmd)}")
    try:
        # Use Popen to launch in background and detached state
        if os.name == 'nt':
            # DETACHED_PROCESS = 0x00000008 ensures the child process runs independently of the parent console/process
            subprocess.Popen(agent_cmd, creationflags=subprocess.DETACHED_PROCESS)
        else:
            subprocess.Popen(agent_cmd)
        
        logger.info("AutoPrint Agent started successfully in background. Launcher exiting.")
        sys.exit(0)
    except Exception as e:
        logger.exception(f"Failed to spawn AutoPrint Agent: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
```

---

## 6. Onboarding Setup Wizard UI

A Tkinter GUI with custom theme styling. Built to validate connections and printers. Spools print tests inside a separate thread to keep the interface smooth and responsive.

*   **File Path**: [setup_wizard.py](file:///f:/Projects/Printer%20automation/desktop-agent/setup_wizard.py)
*   **Action**: Modified & Rewritten

```python
import sys
import os
import tkinter as tk
from tkinter import ttk, messagebox
import logging

import config_manager
import config
import printer_manager
import test_print
from shop_resolver import extract_shop_code, resolve_shop_code

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] SetupWizard: %(message)s")
logger = logging.getLogger("SetupWizard")

class SetupWizard(tk.Tk):
    def __init__(self, change_printer_mode=False):
        super().__init__()
        self.change_printer_mode = change_printer_mode
        
        # Configure main window
        self.title("AutoPrint Setup Wizard")
        self.geometry("520x420")
        self.resizable(False, False)
        
        # UI State Variables
        self.shop_code_input = tk.StringVar(value="")
        self.resolved_shop_id = ""
        self.resolved_shop_name = ""
        self.resolved_status_text = tk.StringVar(value="")
        self.is_resolved = tk.BooleanVar(value=False)
        self.selected_printer = tk.StringVar(value="")
        self.test_print_success = tk.BooleanVar(value=False)
        self.printers_list = []
        
        # Load existing config if available
        self.config = config_manager.load_config()
        if self.config:
            existing_code = self.config.get("shop_code", "")
            if existing_code:
                self.shop_code_input.set(existing_code)
                self.resolved_shop_id = self.config.get("shop_id", "")
                self.resolved_shop_name = self.config.get("shop_name", "")
                self.is_resolved.set(True)
                self.resolved_status_text.set(f"✓ Connected to {self.resolved_shop_name} ✅")
            self.selected_printer.set(self.config.get("printer_name", ""))
                
        # Center the window on the screen
        self.center_window()
        
        # Frame Container
        self.container = ttk.Frame(self)
        self.container.pack(fill="both", expand=True, padx=25, pady=25)
        
        # Set Modern Styles
        self.setup_styles()
        
        # Manage Screen Stack
        self.screens = ["welcome", "shop_resolution", "printer_selection", "test_print", "finish"]
        self.current_screen_idx = 0
        self.show_screen(self.screens[self.current_screen_idx])
        
    def center_window(self):
        self.update_idletasks()
        width = self.winfo_width()
        height = self.winfo_height()
        x = (self.winfo_screenwidth() // 2) - (width // 2)
        y = (self.winfo_screenheight() // 2) - (height // 2)
        self.geometry(f"{width}x{height}+{x}+{y}")
        
    def setup_styles(self):
        style = ttk.Style(self)
        style.theme_use("clam")
        
        # Custom colors
        style.configure(".", font=("Segoe UI", 10))
        style.configure("Header.TLabel", font=("Segoe UI", 16, "bold"), foreground="#1c1c1e")
        style.configure("Subheader.TLabel", font=("Segoe UI", 10), foreground="#6c6c70")
        style.configure("Wiz.TButton", font=("Segoe UI", 10, "bold"), padding=6)
        style.configure("Accent.TButton", font=("Segoe UI", 10, "bold"), padding=6, background="#0071e3", foreground="white")
        style.map("Accent.TButton", background=[("active", "#0056b3")])
        
    def clear_container(self):
        for widget in self.container.winfo_children():
            widget.destroy()
            
    def show_screen(self, screen_name):
        self.clear_container()
        
        # Header Area
        header_frame = ttk.Frame(self.container)
        header_frame.pack(fill="x", pady=(0, 20))
        
        title_label = ttk.Label(header_frame, style="Header.TLabel")
        title_label.pack(anchor="w")
        
        # Content Area
        content_frame = ttk.Frame(self.container)
        content_frame.pack(fill="both", expand=True)
        
        # Footer Area
        footer_frame = ttk.Frame(self.container)
        footer_frame.pack(fill="x", side="bottom", pady=(20, 0))
        
        # Back/Next/Cancel buttons
        btn_cancel = ttk.Button(footer_frame, text="Cancel", style="Wiz.TButton", command=self.on_cancel)
        btn_cancel.pack(side="left")
        
        btn_next = ttk.Button(footer_frame, text="Continue", style="Accent.TButton", command=self.on_next)
        btn_next.pack(side="right", padx=(10, 0))
        self.btn_next = btn_next
        
        btn_back = ttk.Button(footer_frame, text="Back", style="Wiz.TButton", command=self.on_back)
        if self.current_screen_idx > 0:
            btn_back.pack(side="right")
        self.btn_back = btn_back
        
        # Load screen-specific UI elements
        if screen_name == "welcome":
            title_label.config(text="Welcome to AutoPrint")
            self.draw_welcome(content_frame)
        elif screen_name == "shop_resolution":
            title_label.config(text="Connect Your Shop")
            self.draw_shop_resolution(content_frame)
        elif screen_name == "printer_selection":
            title_label.config(text="Select Target Printer")
            self.draw_printer_selection(content_frame)
        elif screen_name == "test_print":
            title_label.config(text="Test Print Verification")
            self.draw_test_print(content_frame)
        elif screen_name == "finish":
            title_label.config(text="AutoPrint Setup Complete")
            self.draw_finish(content_frame)
            
    # ── Screen Drawings ───────────────────────────
    
    def draw_welcome(self, parent):
        lbl = ttk.Label(
            parent,
            text=(
                "AutoPrint automates printing workflows for print shops.\n\n"
                "This setup wizard will connect this computer's background agent "
                "to your shop's online print portal queue.\n\n"
                "Click Continue to start."
            ),
            wraplength=450,
            justify="left"
        )
        lbl.pack(anchor="w", pady=10)
        
    def draw_shop_resolution(self, parent):
        lbl = ttk.Label(
            parent,
            text="Enter your Shop Code or Paste Setup URL:",
            wraplength=450,
            justify="left"
        )
        lbl.pack(anchor="w", pady=(0, 10))
        
        entry = ttk.Entry(
            parent,
            textvariable=self.shop_code_input,
            font=("Segoe UI", 12),
            width=45
        )
        entry.pack(anchor="w", pady=5)
        entry.focus()
        
        self.btn_validate = ttk.Button(
            parent,
            text="Validate Shop Connection",
            style="Wiz.TButton",
            command=self.run_shop_validation
        )
        self.btn_validate.pack(anchor="w", pady=10)
        
        self.lbl_status = ttk.Label(
            parent,
            textvariable=self.resolved_status_text,
            font=("Segoe UI", 11, "bold")
        )
        self.lbl_status.pack(anchor="w", pady=5)
        
        if self.is_resolved.get():
            self.lbl_status.config(foreground="#249c47")
            self.btn_next.config(state="normal")
        else:
            if self.resolved_status_text.get():
                self.lbl_status.config(foreground="#ff3b30")
            self.btn_next.config(state="disabled")
            
    def draw_printer_selection(self, parent):
        lbl = ttk.Label(
            parent,
            text="Select the printer where incoming jobs should print:",
            wraplength=450,
            justify="left"
        )
        lbl.pack(anchor="w", pady=(0, 10))
        
        # Enumerate printers
        self.printers_list = printer_manager.enumerate_printers()
        
        # Listbox for printer selection
        list_frame = ttk.Frame(parent)
        list_frame.pack(fill="both", expand=True, pady=5)
        
        scrollbar = ttk.Scrollbar(list_frame, orient="vertical")
        scrollbar.pack(side="right", fill="y")
        
        self.printer_listbox = tk.Listbox(
            list_frame,
            yscrollcommand=scrollbar.set,
            font=("Segoe UI", 10),
            bd=1,
            relief="solid",
            highlightthickness=0
        )
        self.printer_listbox.pack(fill="both", expand=True, side="left")
        scrollbar.config(command=self.printer_listbox.yview)
        
        # Insert printers
        selected_index = 0
        for idx, printer in enumerate(self.printers_list):
            self.printer_listbox.insert(tk.END, printer)
            if printer == self.selected_printer.get():
                selected_index = idx
                
        if self.printers_list:
            self.printer_listbox.select_set(selected_index)
            self.printer_listbox.activate(selected_index)
            self.printer_listbox.see(selected_index)
            
    def draw_test_print(self, parent):
        selected = self.selected_printer.get()
        lbl = ttk.Label(
            parent,
            text=f"Selected Printer: {selected}\n\n"
                 "To complete setup, please run a test print job to ensure that SumatraPDF "
                 "and local driver configurations are working properly.",
            wraplength=450,
            justify="left"
        )
        lbl.pack(anchor="w", pady=(0, 15))
        
        # Test Print Button
        self.btn_test = ttk.Button(parent, text="Print Test Page", style="Wiz.TButton", command=self.run_test_print)
        self.btn_test.pack(anchor="w", pady=10)
        
        # Status Message
        self.lbl_print_status = ttk.Label(parent, text="", font=("Segoe UI", 10, "italic"))
        self.lbl_print_status.pack(anchor="w", pady=5)
        
        # Checkbox to verify print success
        self.chk_confirm = ttk.Checkbutton(
            parent,
            text="My test receipt page printed successfully",
            variable=self.test_print_success,
            command=self.toggle_next_on_confirm
        )
        self.chk_confirm.pack(anchor="w", pady=10)
        
        if not self.test_print_success.get():
            self.btn_next.config(state="disabled")
            
    def toggle_next_on_confirm(self):
        if self.test_print_success.get():
            self.btn_next.config(state="normal")
        else:
            self.btn_next.config(state="disabled")
            
    def draw_finish(self, parent):
        lbl = ttk.Label(
            parent,
            text="Configuration Successful!\n\n"
                 "AutoPrint setup is complete. The background agent will automatically check "
                 "for and download PDF print jobs from your portal queue.\n\n"
                 "Click Finish to launch the agent.",
            wraplength=450,
            justify="left"
        )
        lbl.pack(anchor="w", pady=10)
        self.btn_next.config(text="Finish")
        
    # ── Action Handlers ───────────────────────────
    
    def run_shop_validation(self):
        raw_input = self.shop_code_input.get().strip()
        if not raw_input:
            self.resolved_status_text.set("❌ Please enter a shop code or setup URL.")
            self.lbl_status.config(foreground="#ff3b30")
            self.is_resolved.set(False)
            self.btn_next.config(state="disabled")
            return
            
        shop_code = extract_shop_code(raw_input)
        if not shop_code:
            self.resolved_status_text.set("❌ Invalid URL or Shop Code format.")
            self.lbl_status.config(foreground="#ff3b30")
            self.is_resolved.set(False)
            self.btn_next.config(state="disabled")
            return
            
        self.resolved_status_text.set("Connecting to AutoPrint Cloud...")
        self.lbl_status.config(foreground="#6c6c70")
        self.btn_validate.config(state="disabled")
        self.update()
        
        res = resolve_shop_code(shop_code)
        
        self.btn_validate.config(state="normal")
        
        if res["success"]:
            self.resolved_shop_id = res["shop_id"]
            self.resolved_shop_name = res["shop_name"]
            self.is_resolved.set(True)
            self.resolved_status_text.set(f"✓ Connected to {res['shop_name']} ✅")
            self.lbl_status.config(foreground="#249c47")
            self.btn_next.config(state="normal")
        else:
            self.is_resolved.set(False)
            self.resolved_status_text.set(f"❌ Error: {res['error']}")
            self.lbl_status.config(foreground="#ff3b30")
            self.btn_next.config(state="disabled")
            
    def run_test_print(self):
        self.lbl_print_status.config(text="Sending test print job to Windows Spooler...", foreground="#6c6c70")
        self.btn_test.config(state="disabled")
        self.btn_back.config(state="disabled")
        self.btn_next.config(state="disabled")
        self.update()
        
        import threading
        
        def async_test_print():
            printer_name = self.selected_printer.get()
            success, error = test_print.print_test_page(printer_name)
            self.after(0, lambda: self.on_test_print_complete(success, error))
            
        threading.Thread(target=async_test_print, daemon=True).start()
        
    def on_test_print_complete(self, success, error):
        self.btn_test.config(state="normal")
        self.btn_back.config(state="normal")
        if success:
            self.lbl_print_status.config(text="✓ Test Print Sent! Confirm output below.", foreground="#249c47")
            self.chk_confirm.focus_set()
        else:
            self.lbl_print_status.config(text=f"❌ Print Failed: {error}", foreground="#ff3b30")
            self.test_print_success.set(False)
            self.btn_next.config(state="disabled")
            
    def on_next(self):
        current_screen = self.screens[self.current_screen_idx]
        
        if current_screen == "shop_resolution":
            if not self.is_resolved.get():
                messagebox.showerror("Error", "Please validate your shop connection before continuing.")
                return
                
        elif current_screen == "printer_selection":
            selection = self.printer_listbox.curselection()
            if not selection:
                messagebox.showerror("Error", "Please select a printer from the list.")
                return
            printer_name = self.printer_listbox.get(selection[0])
            self.selected_printer.set(printer_name)
            
        elif current_screen == "test_print":
            if not self.test_print_success.get():
                messagebox.showerror("Error", "Please verify that the test page printed successfully.")
                return
                
        elif current_screen == "finish":
            self.save_and_exit()
            return
            
        self.current_screen_idx += 1
        self.show_screen(self.screens[self.current_screen_idx])
        
    def on_back(self):
        if self.current_screen_idx > 0:
            self.current_screen_idx -= 1
            self.show_screen(self.screens[self.current_screen_idx])
            
    def on_cancel(self):
        if messagebox.askyesno("Cancel Setup", "Are you sure you want to exit the setup wizard?"):
            logger.info("Setup wizard cancelled by user.")
            self.destroy()
            sys.exit(1)
            
    def save_and_exit(self):
        raw_input = self.shop_code_input.get().strip()
        shop_code = extract_shop_code(raw_input)
        
        config_data = {
            "config_version": 1,
            "shop_id": self.resolved_shop_id,
            "shop_code": shop_code,
            "shop_name": self.resolved_shop_name,
            "printer_name": self.selected_printer.get(),
            "agent_enabled": True,
            "first_run_completed": True
        }
        
        success = config_manager.save_config(config_data)
        if success:
            logger.info("Configuration successfully written to LocalAppData.")
            messagebox.showinfo("Success", f"AutoPrint Setup Completed! Agent is connected to {self.resolved_shop_name}.")
            self.destroy()
            sys.exit(0)
        else:
            messagebox.showerror("Error", "Failed to save configuration. Please check folder permissions.")

if __name__ == "__main__":
    logger.info("Starting Setup Wizard.")
    app = SetupWizard()
    app.mainloop()
```

---

## 7. System Tray App Process Matching

Modified the Tray UI code to match the new output executable names generated by PyInstaller, aligning `AutoPrintLauncher.exe` references with `Launcher.exe`.

*   **File Path**: [tray_app.py](file:///f:/Projects/Printer%20automation/desktop-agent/tray_app.py) (Line 167)
*   **Action**: Modified

```diff
        if getattr(sys, 'frozen', False):
-           launcher_cmd = [os.path.join(base_dir, "AutoPrintLauncher.exe")]
+           launcher_cmd = [os.path.join(base_dir, "Launcher.exe")]
        else:
            launcher_cmd = [sys.executable, os.path.join(base_dir, "launcher.py")]
```

---

## 8. PyInstaller Build Configuration

Configured a single multi-binary bundle mapping our three python entry points (`launcher.py`, `setup_wizard.py`, and `agent.py`) to three distinct compiled Windows executables (`Launcher.exe`, `AutoPrintSetupWizard.exe`, and `AutoPrintAgent.exe`) sharing a common directory layout and dependencies.

*   **File Path**: [autoprint.spec](file:///f:/Projects/Printer%20automation/desktop-agent/autoprint.spec)
*   **Action**: Created

```python
# -*- mode: python ; coding: utf-8 -*-

block_cipher = None

a_launcher = Analysis(
    ['launcher.py'],
    pathex=[],
    binaries=[],
    datas=[('assets', 'assets')],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

a_wizard = Analysis(
    ['setup_wizard.py'],
    pathex=[],
    binaries=[],
    datas=[('assets', 'assets')],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

a_agent = Analysis(
    ['agent.py'],
    pathex=[],
    binaries=[],
    datas=[('sumatrapdf', 'sumatrapdf'), ('assets', 'assets')],
    hiddenimports=['win32print', 'win32timezone'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

MERGE(
    (a_launcher, 'Launcher', 'Launcher'),
    (a_wizard, 'AutoPrintSetupWizard', 'AutoPrintSetupWizard'),
    (a_agent, 'AutoPrintAgent', 'AutoPrintAgent')
)

pyz_launcher = PYZ(a_launcher.pure, a_launcher.zipped_data, cipher=block_cipher)
pyz_wizard = PYZ(a_wizard.pure, a_wizard.zipped_data, cipher=block_cipher)
pyz_agent = PYZ(a_agent.pure, a_agent.zipped_data, cipher=block_cipher)

exe_launcher = EXE(
    pyz_launcher,
    a_launcher.scripts,
    [],
    exclude_binaries=True,
    name='Launcher',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

exe_wizard = EXE(
    pyz_wizard,
    a_wizard.scripts,
    [],
    exclude_binaries=True,
    name='AutoPrintSetupWizard',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

exe_agent = EXE(
    pyz_agent,
    a_agent.scripts,
    [],
    exclude_binaries=True,
    name='AutoPrintAgent',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe_launcher,
    a_launcher.binaries,
    a_launcher.zipfiles,
    a_launcher.datas,
    
    exe_wizard,
    a_wizard.binaries,
    a_wizard.zipfiles,
    a_wizard.datas,
    
    exe_agent,
    a_agent.binaries,
    a_agent.zipfiles,
    a_agent.datas,
    
    strip=False,
    upx=True,
    upx_exclude=[],
    name='AutoPrint',
)
```

---

## 9. Inno Setup Packaging Configuration

Compiles the PyInstaller `dist\AutoPrint` directory layout into a single, compact `AutoPrintSetup.exe` wizard. Installs to `%LOCALAPPDATA%`, creates start menu and desktop configuration links, registers autostart, and terminates any running instances before updating code to prevent file locks.

*   **File Path**: [autoprint_setup.iss](file:///f:/Projects/Printer%20automation/desktop-agent/autoprint_setup.iss)
*   **Action**: Created

```ini
; AutoPrint Installer Configuration Script
; Compiles the PyInstaller 'dist\AutoPrint' directory into a single AutoPrintSetup.exe.

[Setup]
AppName=AutoPrint
AppVersion=1.0.0
AppPublisher=AutoPrint
DefaultDirName={localappdata}\Programs\AutoPrint
DefaultGroupName=AutoPrint
OutputDir=dist
OutputBaseFilename=AutoPrintSetup
Compression=lzma
SolidCompression=yes
; 'lowest' privileges bypasses Windows UAC dialog prompts completely
PrivilegesRequired=lowest
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=yes
; Automatically closes running instances of our executables to prevent file lock errors
CloseApplications=force

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
; Copy all files compiled in the distribution directory
Source: "dist\AutoPrint\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Dirs]
; Pre-create folders required by the agent
Name: "{app}\temp"
Name: "{app}\logs"

[Icons]
; Run the launcher when starting AutoPrint from the Start Menu
Name: "{userprograms}\AutoPrint"; Filename: "{app}\Launcher.exe"; IconFilename: "{app}\assets\icon.ico"; IconIndex: 0
; Create a settings shortcut on the Desktop pointing to the Setup Wizard
Name: "{userdesktop}\AutoPrint Configuration"; Filename: "{app}\AutoPrintSetupWizard.exe"; Parameters: "--change-printer"; IconFilename: "{app}\assets\icon.ico"; IconIndex: 0

[Registry]
; Register the launcher in the Current User Startup registry run keys for automatic boot on restart
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "AutoPrintLauncher"; ValueData: """{app}\Launcher.exe"""; Flags: uninsdeletevalue

[Run]
; Launch Launcher.exe detached and post-install, without blocking installer termination
Filename: "{app}\Launcher.exe"; Description: "Launch AutoPrint Agent"; Flags: postinstall nowait
```

---

## 10. How to Compile & Verify the Installer

Follow these steps to generate and run the installer:

### Step A: Compile the Executables via PyInstaller
In your Windows Terminal, run:
```powershell
# 1. Activate your python virtual environment
.\.venv\Scripts\activate

# 2. Run PyInstaller to build the distribution binaries
pyinstaller --noconfirm autoprint.spec
```
This compiles the code into `dist\AutoPrint`.

### Step B: Compile the Installer via Inno Setup
1. Open the **Inno Setup Compiler** application on your machine.
2. Click **File ➔ Open** and select:
   `f:\Projects\Printer automation\desktop-agent\autoprint_setup.iss`
3. Press **Ctrl + F9** (or click **Build ➔ Compile**).
4. This packages the compiled folder into a single executable located at:
   `f:\Projects\Printer automation\desktop-agent\dist\AutoPrintSetup.exe`

### Step C: Verification Workflow
1. Double-click the compiled `dist\AutoPrintSetup.exe`.
2. The installation will proceed instantly without requesting administrator privileges (UAC bypass).
3. The Setup Wizard will auto-launch, asking for a shop code or URL.
4. Input `KRL004` (or `https://autoprint.in/setup/KRL004`) and click **Validate Shop Connection**.
5. Select your desired printer queue from the list, click **Print Test Page**, verify the spooled output, confirm the checkbox, and click **Finish**.
6. The background tray agent will launch automatically, ready to poll and print jobs!
