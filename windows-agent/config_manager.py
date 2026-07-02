import os
import json
import logging

CONFIG_DIR = os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "AutoPrint")
CONFIG_PATH = os.path.join(CONFIG_DIR, "config.json")
LOG_DIR = os.path.join(CONFIG_DIR, "logs")
CURRENT_VERSION = 1

def migrate_config(config_data: dict) -> dict:
    """
    Ensures that older configuration files are migrated sequentially 
    to the latest version, preserving backwards compatibility.
    """
    if not isinstance(config_data, dict):
        config_data = {}
        
    version = config_data.get("version", 0)
    
    # Example Migration: Version 0 to 1
    if version < 1:
        # Initialize default values for version 1 if missing
        if "config_version" in config_data:
            config_data["version"] = config_data.pop("config_version")
        else:
            config_data["version"] = 1
            
        if "first_run_completed" not in config_data:
            config_data["first_run_completed"] = False
        if "printer_name" not in config_data:
            config_data["printer_name"] = ""
        if "printer_bw" not in config_data:
            config_data["printer_bw"] = ""
        if "printer_color" not in config_data:
            config_data["printer_color"] = ""
        if "shop_id" not in config_data:
            config_data["shop_id"] = ""
        if "shop_code" not in config_data:
            config_data["shop_code"] = ""
        if "shop_name" not in config_data:
            config_data["shop_name"] = ""
            
    # Future migrations (e.g., v1 -> v2) would go here:
    # if config_data["version"] == 1:
    #     ...
    #     config_data["version"] = 2
    
    config_data["version"] = CURRENT_VERSION
    return config_data

def load_config() -> dict:
    """
    Loads configuration dictionary from %LocalAppData%\\AutoPrint\\config.json.
    Runs migrations on the loaded config to guarantee schema compliance.
    """
    if not os.path.exists(CONFIG_PATH):
        return migrate_config({})
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
            if not isinstance(data, dict):
                data = {}
            # Auto-run migrations on load
            migrated_data = migrate_config(data)
            return migrated_data
    except Exception:
        return migrate_config({})

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
        
        # Merge might change version back or introduce changes, run migration again
        existing = migrate_config(existing)
            
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(existing, f, indent=4)
        return True
    except Exception:
        return False

def get_selected_printer() -> str:
    """Returns the legacy configured printer name, or an empty string if not set."""
    return load_config().get("printer_name", "")

def get_bw_printer() -> str:
    """Returns B&W mapped printer or legacy printer name."""
    cfg = load_config()
    return cfg.get("printer_bw") or cfg.get("printer_name") or ""

def get_color_printer() -> str:
    """Returns Color mapped printer or legacy printer name."""
    cfg = load_config()
    return cfg.get("printer_color") or cfg.get("printer_name") or ""

def is_first_run_completed() -> bool:
    """Returns True if the setup wizard has been run and completed, False otherwise."""
    return load_config().get("first_run_completed", False)

PRINTED_LOG_PATH = os.path.join(CONFIG_DIR, "printed_jobs.json")

def add_printed_job(job_id: str):
    """Logs a job ID to the local print log to prevent duplicate printing."""
    try:
        os.makedirs(CONFIG_DIR, exist_ok=True)
        jobs = []
        if os.path.exists(PRINTED_LOG_PATH):
            with open(PRINTED_LOG_PATH, "r", encoding="utf-8") as f:
                try:
                    jobs = json.load(f)
                except Exception:
                    jobs = []
                if not isinstance(jobs, list):
                    jobs = []
        if job_id not in jobs:
            jobs.append(job_id)
            # Cap the log size to last 1000 jobs to avoid growing indefinitely
            if len(jobs) > 1000:
                jobs = jobs[-1000:]
            with open(PRINTED_LOG_PATH, "w", encoding="utf-8") as f:
                json.dump(jobs, f)
    except Exception as e:
        logging.getLogger("PrintAgent.ConfigManager").error(f"Failed to log printed job: {e}")

def is_job_printed_locally(job_id: str) -> bool:
    """Checks if the job was already printed on this machine."""
    try:
        if not os.path.exists(PRINTED_LOG_PATH):
            return False
        with open(PRINTED_LOG_PATH, "r", encoding="utf-8") as f:
            try:
                jobs = json.load(f)
            except Exception:
                return False
            if isinstance(jobs, list):
                return job_id in jobs
    except Exception:
        pass
    return False

