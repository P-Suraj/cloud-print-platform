import sys
import os
import tkinter as tk
from tkinter import ttk, messagebox
import logging
import threading
import win32event
import win32api
import winerror

import config_manager
import config
import printer_manager
import test_print
from shop_resolver import extract_shop_code, resolve_shop_code

# Configure logging to standardized LocalAppData folder
LOG_FILE = os.path.join(config_manager.LOG_DIR, "setup_wizard.log")
os.makedirs(config_manager.LOG_DIR, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] SetupWizard: %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(LOG_FILE, encoding='utf-8')
    ]
)
logger = logging.getLogger("SetupWizard")

# Global reference to prevent garbage collection of the mutex handle
wizard_mutex = None

def acquire_wizard_mutex():
    """Ensures only a single Setup Wizard can run at any time."""
    global wizard_mutex
    try:
        wizard_mutex = win32event.CreateMutex(None, True, "Local\\AutoPrintWizardMutex")
        if win32api.GetLastError() == winerror.ERROR_ALREADY_EXISTS:
            logger.info("Another SetupWizard instance is already running. Exiting.")
            sys.exit(0)
    except Exception as e:
        logger.warning(f"Failed to acquire wizard mutex: {e}")

class SetupWizard(tk.Tk):
    def __init__(self, change_printer_mode=False):
        super().__init__()
        self.change_printer_mode = change_printer_mode
        
        # Configure main window
        self.title("AutoPrint Setup Wizard")
        self.geometry("520x420")
        self.resizable(False, False)
        
        # Load existing config if available
        self.config = config_manager.load_config()
        is_reconfig = False
        if self.config:
            is_reconfig = self.config.get("first_run_completed", False)
            
        # UI State Variables
        self.shop_code_input = tk.StringVar(value="")
        self.resolved_shop_id = ""
        self.resolved_shop_name = ""
        self.resolved_status_text = tk.StringVar(value="")
        self.is_resolved = tk.BooleanVar(value=False)
        self.selected_printer = tk.StringVar(value="")
        self.selected_printer_bw = tk.StringVar(value="")
        self.selected_printer_color = tk.StringVar(value="")
        self.test_print_success = tk.BooleanVar(value=is_reconfig)
        self.printers_list = []
        
        # Bind variable trace to reset validation status on shop code text changes
        self.shop_code_input.trace_add("write", self.on_shop_code_change)
        
        if self.config:
            existing_code = self.config.get("shop_code", "")
            if existing_code:
                self.shop_code_input.set(existing_code)
                self.resolved_shop_id = self.config.get("shop_id", "")
                self.resolved_shop_name = self.config.get("shop_name", "")
                self.is_resolved.set(True)
                self.resolved_status_text.set(f"✓ Connected to {self.resolved_shop_name} ✅")
            self.selected_printer.set(self.config.get("printer_name", ""))
            self.selected_printer_bw.set(self.config.get("printer_bw", self.config.get("printer_name", "")))
            self.selected_printer_color.set(self.config.get("printer_color", self.config.get("printer_name", "")))
                
        # Center the window on the screen
        self.center_window()
        
        # Frame Container
        self.container = ttk.Frame(self)
        self.container.pack(fill="both", expand=True, padx=25, pady=25)
        
        # Set Modern Styles
        self.setup_styles()
        
        # Manage Screen Stack
        if self.change_printer_mode:
            # Skip Welcome and Shop association screens
            self.screens = ["printer_selection", "test_print", "finish"]
        else:
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
        
        self.entry_shop_code = ttk.Entry(
            parent,
            textvariable=self.shop_code_input,
            font=("Segoe UI", 12),
            width=45
        )
        self.entry_shop_code.pack(anchor="w", pady=5)
        self.entry_shop_code.focus()
        
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
        
        # Enforce validation state check on UI render
        if self.is_resolved.get():
            self.lbl_status.config(foreground="#249c47")
            self.btn_next.config(state="normal")
        else:
            if self.resolved_status_text.get():
                self.lbl_status.config(foreground="#ff3b30")
            self.btn_next.config(state="disabled")
            
    def on_shop_code_change(self, *args):
        """Resets the shop resolution state whenever the text in the entry box changes."""
        if self.is_resolved.get():
            logger.info("Shop code changed. Resetting validation status.")
            self.is_resolved.set(False)
            self.resolved_status_text.set("")
            if hasattr(self, 'btn_next') and self.btn_next.winfo_exists():
                self.btn_next.config(state="disabled")
    def draw_printer_selection(self, parent):
        lbl = ttk.Label(
            parent,
            text="Assign default printers for each job color mode:",
            wraplength=450,
            justify="left"
        )
        lbl.pack(anchor="w", pady=(0, 15))
        
        # 1. Black & White printer selection
        lbl_bw = ttk.Label(parent, text="Default Black & White (Laser/Fast) Printer:")
        lbl_bw.pack(anchor="w", pady=(5, 2))
        self.cb_printer_bw = ttk.Combobox(
            parent,
            textvariable=self.selected_printer_bw,
            state="readonly",
            font=("Segoe UI", 10),
            width=50
        )
        self.cb_printer_bw.pack(anchor="w", pady=(0, 10))
        self.cb_printer_bw.bind("<<ComboboxSelected>>", self.on_printer_select_change)
        
        # 2. Color printer selection
        lbl_color = ttk.Label(parent, text="Default Color (Inkjet) Printer:")
        lbl_color.pack(anchor="w", pady=(5, 2))
        self.cb_printer_color = ttk.Combobox(
            parent,
            textvariable=self.selected_printer_color,
            state="readonly",
            font=("Segoe UI", 10),
            width=50
        )
        self.cb_printer_color.pack(anchor="w", pady=(0, 15))
        self.cb_printer_color.bind("<<ComboboxSelected>>", self.on_printer_select_change)
        
        # Bottom controls (Refresh button and warnings)
        controls_frame = ttk.Frame(parent)
        controls_frame.pack(fill="x", pady=5)
        
        self.btn_refresh_printers = ttk.Button(
            controls_frame, 
            text="Refresh Printers", 
            style="Wiz.TButton", 
            command=self.refresh_printer_list
        )
        self.btn_refresh_printers.pack(side="left")
        
        self.lbl_printer_warning = ttk.Label(
            controls_frame, 
            text="", 
            font=("Segoe UI", 9, "bold"), 
            foreground="#ff3b30"
        )
        self.lbl_printer_warning.pack(side="left", padx=15)
        
        # Initial printer loading
        self.refresh_printer_list()

    def refresh_printer_list(self):
        """Queries local print queues and refreshes the combobox values."""
        self.printers_list = printer_manager.enumerate_printers()
        
        if self.printers_list:
            self.cb_printer_bw['values'] = self.printers_list
            self.cb_printer_color['values'] = self.printers_list
            
            # Select first printer as fallback if not set
            if not self.selected_printer_bw.get() or self.selected_printer_bw.get() not in self.printers_list:
                self.selected_printer_bw.set(self.printers_list[0])
            if not self.selected_printer_color.get() or self.selected_printer_color.get() not in self.printers_list:
                self.selected_printer_color.set(self.printers_list[0])
                
            if hasattr(self, 'lbl_printer_warning') and self.lbl_printer_warning.winfo_exists():
                self.lbl_printer_warning.config(text="")
        else:
            self.selected_printer_bw.set("")
            self.selected_printer_color.set("")
            self.cb_printer_bw['values'] = []
            self.cb_printer_color['values'] = []
            if hasattr(self, 'lbl_printer_warning') and self.lbl_printer_warning.winfo_exists():
                self.lbl_printer_warning.config(text="⚠️ No printers detected! Connect a device and click Refresh.")
        
        self.on_printer_select_change()

    def on_printer_select_change(self, event=None):
        """Toggles the Continue button and validates selection state."""
        bw = self.selected_printer_bw.get()
        color = self.selected_printer_color.get()
        
        # Set self.selected_printer for backward compatibility / tests (e.g. test_print)
        self.selected_printer.set(bw)
        
        if bw and color:
            if hasattr(self, 'btn_next') and self.btn_next.winfo_exists():
                self.btn_next.config(state="normal")
        else:
            if hasattr(self, 'btn_next') and self.btn_next.winfo_exists():
                self.btn_next.config(state="disabled")

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
        self.btn_next.config(state="disabled")
        if hasattr(self, 'btn_back') and self.btn_back.winfo_exists():
            self.btn_back.config(state="disabled")
        self.update()
        
        # Threaded validation to prevent UI freeze
        def bg_validation():
            res = resolve_shop_code(shop_code)
            self.after(0, lambda: self.on_validation_complete(res))
            
        threading.Thread(target=bg_validation, daemon=True).start()
        
    def on_validation_complete(self, res):
        self.btn_validate.config(state="normal")
        if hasattr(self, 'btn_back') and self.btn_back.winfo_exists():
            self.btn_back.config(state="normal")
            
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
            if not self.selected_printer.get():
                messagebox.showerror("Error", "Please select a printer from the list.")
                return
            
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
            "printer_name": self.selected_printer.get(),
            "printer_bw": self.selected_printer_bw.get(),
            "printer_color": self.selected_printer_color.get(),
            "agent_enabled": True,
            "first_run_completed": True
        }
        
        if not self.change_printer_mode or self.resolved_shop_id:
            config_data["shop_id"] = self.resolved_shop_id
            config_data["shop_code"] = shop_code
            config_data["shop_name"] = self.resolved_shop_name
        
        # Save config handles merge automatically
        success = config_manager.save_config(config_data)
        if success:
            logger.info("Configuration successfully written to LocalAppData.")
            messagebox.showinfo("Success", f"AutoPrint Setup Completed! Agent is connected to {self.resolved_shop_name}.")
            self.destroy()
            sys.exit(0)
        else:
            messagebox.showerror("Error", "Failed to save configuration. Please check folder permissions.")

if __name__ == "__main__":
    # Acquire Setup Wizard Named Mutex to prevent duplicate screens
    acquire_wizard_mutex()

    logger.info("Starting Setup Wizard.")
    
    # Parse command line argument check
    change_printer_mode = False
    if "--change-printer" in sys.argv:
        logger.info("Wizard initialized in --change-printer mode.")
        change_printer_mode = True
        
    app = SetupWizard(change_printer_mode=change_printer_mode)
    app.mainloop()
