import patch_httpx
import os
import sys
import config_manager

# ── Paths ───────────────────────────────────────
def get_resource_dir() -> str:
    """Returns the resource directory containing packaged data (e.g. assets, sumatrapdf)."""
    if getattr(sys, 'frozen', False):
        return getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(sys.executable)))
    return os.path.dirname(os.path.abspath(__file__))

def get_bin_dir() -> str:
    """Returns the base directory containing compiled executables."""
    if getattr(sys, 'frozen', False):
        return os.path.dirname(os.path.abspath(sys.executable))
    return os.path.dirname(os.path.abspath(__file__))

RESOURCE_DIR = get_resource_dir()
BASE_DIR = get_bin_dir()

# Watched folder where new JSON jobs & PDFs are placed
WATCH_DIR = os.path.join(config_manager.CONFIG_DIR, "queue")

# Temp folder for intermediate file processing
TEMP_DIR = os.path.join(config_manager.CONFIG_DIR, "temp")

# Path to the SumatraPDF executable (located in resource directory)
SUMATRA_EXE = os.path.join(RESOURCE_DIR, "sumatrapdf", "SumatraPDF.exe")

# Log file path under standard LocalAppData directory
LOG_FILE = os.path.join(config_manager.LOG_DIR, "agent.log")

# ── Runtime Behavior ────────────────────────────
# Set to True to simulate printing without a real printer
SIMULATION_MODE = False

# Set to True to use Supabase instead of local files
USE_CLOUD_QUEUE = True

# Supabase Configuration
import config_manager
local_cfg = config_manager.load_config()
SUPABASE_URL = local_cfg.get("supabase_url") or os.environ.get("SUPABASE_URL") or "https://your-project.supabase.co"
SUPABASE_KEY = local_cfg.get("supabase_key") or os.environ.get("SUPABASE_KEY") or "your-supabase-anon-or-service-key"
SUPABASE_BUCKET = local_cfg.get("supabase_bucket") or os.environ.get("SUPABASE_BUCKET") or "print-jobs"
SHOP_ID = local_cfg.get("shop_id") or os.environ.get("SHOP_ID") or "your-shop-uuid-here"

# How often to check the queue (seconds)
POLL_INTERVAL = 2.0


# Ensure essential folders exist
for folder in [WATCH_DIR, TEMP_DIR, config_manager.LOG_DIR, os.path.dirname(SUMATRA_EXE)]:
    os.makedirs(folder, exist_ok=True)

# ── Printer Helper ──────────────────────────────
def get_default_printer():
    """
    Get the default Windows printer. Fallback to a mock name if 
    pywin32 is not installed or if running in simulation mode.
    """
    if SIMULATION_MODE:
        return "MOCK_PRINTER_SYSTEM"
        
    try:
        import win32print
        return win32print.GetDefaultPrinter()
    except ImportError:
        return "DEFAULT_PRINTER_FALLBACK (pywin32 missing)"
    except Exception as e:
        return f"ERROR_RESOLVING_PRINTER ({str(e)})"
