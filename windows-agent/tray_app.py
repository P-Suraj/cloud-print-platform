import os
import sys
import subprocess
import threading
import logging
from PIL import Image, ImageDraw
import pystray

import config_manager

logger = logging.getLogger("PrintAgent.TrayApp")

class SystemTrayApp:
    def __init__(self, agent_instance=None):
        self.agent = agent_instance
        self.icon = None
        self.status = "green"
        self.is_paused = False
        self.thread = None
        
        # Load or create images
        self.icons = {
            "green": self.get_icon_image("green"),
            "blue": self.get_icon_image("blue"),
            "red": self.get_icon_image("red")
        }
        
    def get_icon_image(self, color: str) -> Image:
        """
        Attempts to load the status icon from the assets directory.
        Falls back to dynamically drawing a colored circle using Pillow if missing.
        """
        # Determine assets path (handles PyInstaller _internal resource layout)
        if getattr(sys, 'frozen', False):
            base_dir = getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(sys.executable)))
        else:
            base_dir = os.path.dirname(os.path.abspath(__file__))
        asset_path = os.path.join(base_dir, "assets", f"icon_{color}.ico")
        
        if os.path.exists(asset_path):
            try:
                return Image.open(asset_path)
            except Exception as e:
                logger.warning(f"Failed to load icon from assets ({asset_path}): {e}")
                
        # Fallback: Draw solid color circle
        img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        
        color_map = {
            "green": (36, 156, 71, 255), # Apple green
            "blue": (0, 113, 227, 255),  # Apple blue
            "red": (255, 59, 48, 255)    # Apple red
        }
        fill_color = color_map.get(color, (128, 128, 128, 255))
        
        draw.ellipse([8, 8, 56, 56], fill=fill_color)
        return img

    def create_menu(self):
      pause_label = "Resume Queue" if self.is_paused else "Pause Queue"
      
      return pystray.Menu(
          pystray.MenuItem("Open Dashboard", self.on_open_dashboard),
          pystray.MenuItem("Configure Agent Settings", self.on_change_printer),
          pystray.MenuItem(pause_label, self.on_toggle_pause),
          pystray.MenuItem("View Logs", self.on_view_logs),
          pystray.MenuItem("Restart Agent", self.on_restart),
          pystray.Menu.SEPARATOR,
          pystray.MenuItem("Exit", self.on_exit)
      )

    def run(self):
        """Starts the tray app loop in a separate background daemon thread."""
        self.icon = pystray.Icon(
            "AutoPrint",
            icon=self.icons["green"],
            title="AutoPrint - Ready",
            menu=self.create_menu()
        )
        
        # Start in background thread so it doesn't block the main agent loop
        self.thread = threading.Thread(target=self.icon.run, daemon=True)
        self.thread.start()
        logger.info("System Tray App started in background thread.")

    def set_status(self, status: str):
        """Updates the tray icon color and tooltip message."""
        if status not in self.icons or not self.icon:
            return
        
        self.status = status
        self.icon.icon = self.icons[status]
        
        title_map = {
            "green": "AutoPrint - Connected / Idle",
            "blue": "AutoPrint - Printing Job...",
            "red": "AutoPrint - Connection Error"
        }
        
        if self.is_paused:
            self.icon.title = "AutoPrint - Queue Paused"
        else:
            self.icon.title = title_map.get(status, "AutoPrint")
            
    def update_menu(self):
        """Re-creates the menu to update labels like Pause/Resume."""
        if self.icon:
            self.icon.menu = self.create_menu()

    # ── Menu Action Handlers ──────────────────────

    def on_open_dashboard(self, icon, item):
        logger.info("Opening dashboard...")
        import webbrowser
        # For pilot, opens the local development portal port
        webbrowser.open("http://localhost:5000")

    def on_change_printer(self, icon, item):
        logger.info("Opening printer selection configuration...")
        
        # Determine executable or script path
        base_dir = os.path.dirname(os.path.abspath(sys.executable if getattr(sys, 'frozen', False) else __file__))
        
        if getattr(sys, 'frozen', False):
            wizard_cmd = [os.path.join(base_dir, "AutoPrintSetupWizard.exe")]
        else:
            wizard_cmd = [sys.executable, os.path.join(base_dir, "setup_wizard.py")]
            
        def run_wizard():
            try:
                self.set_status("blue")
                result = subprocess.run(wizard_cmd, check=True)
                if result.returncode == 0:
                    logger.info("Printer updated successfully. Reloading config in Agent.")
                    if self.agent:
                        self.agent.reload_printer_config()
                self.set_status("green")
            except Exception as e:
                logger.error(f"Failed to run printer changer setup: {e}")
                self.set_status("red")
                
        # Run in a separate thread so it doesn't freeze the tray icon UI thread
        threading.Thread(target=run_wizard, daemon=True).start()

    def on_toggle_pause(self, icon, item):
        self.is_paused = not self.is_paused
        logger.info(f"Queue pause state toggled to: {self.is_paused}")
        
        if self.agent:
            self.agent.set_paused(self.is_paused)
            
        self.update_menu()
        self.set_status(self.status)

    def on_view_logs(self, icon, item):
        logger.info("Opening logs...")
        log_file = os.path.join(config_manager.LOG_DIR, "agent.log")
        if os.name == 'nt':
            subprocess.Popen(["notepad.exe", log_file])
        else:
            # Fallback for dev on non-Windows
            subprocess.Popen(["open" if sys.platform == "darwin" else "xdg-open", log_file])

    def on_restart(self, icon, item):
        logger.info("Triggering agent restart via Launcher...")
        base_dir = os.path.dirname(os.path.abspath(sys.executable if getattr(sys, 'frozen', False) else __file__))
        
        if getattr(sys, 'frozen', False):
            launcher_cmd = [os.path.join(base_dir, "Launcher.exe")]
        else:
            launcher_cmd = [sys.executable, os.path.join(base_dir, "launcher.py")]
            
        try:
            # Launch launcher to spawn a fresh agent instance
            subprocess.Popen(launcher_cmd)
            # Exit current instance
            self.on_exit(icon, item)
        except Exception as e:
            logger.error(f"Failed to trigger restart: {e}")

    def on_exit(self, icon, item):
        logger.info("Exit clicked. Shutting down system tray and agent...")
        if self.icon:
            self.icon.stop()
        if self.agent:
            self.agent.shutdown()
