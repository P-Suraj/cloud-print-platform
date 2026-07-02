import os
import sys
import subprocess
import logging
import win32event
import win32api
import winerror

import config_manager

# Configure logging to standardized LocalAppData folder
LOG_FILE = os.path.join(config_manager.LOG_DIR, "launcher.log")
os.makedirs(config_manager.LOG_DIR, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] Launcher: %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(LOG_FILE, encoding='utf-8')
    ]
)
logger = logging.getLogger("Launcher")

# Global reference to prevent garbage collection of the mutex handle
launcher_mutex = None

def check_shutdown_flag():
    """If --shutdown is passed in command arguments, signals the Agent to exit gracefully."""
    if "--shutdown" in sys.argv:
        logger.info("Shutdown flag requested. Signaling agent shutdown event...")
        try:
            # Open the local shutdown event
            event = win32event.OpenEvent(win32event.EVENT_MODIFY_STATE, False, "Local\\AutoPrintShutdownEvent")
            win32event.SetEvent(event)
            logger.info("Shutdown event successfully signaled.")
            print("SUCCESS: Graceful shutdown signal sent to Agent.")
        except Exception as e:
            # If the event doesn't exist, the agent is not running
            logger.info(f"Could not signal shutdown event (is Agent running?): {e}")
            print(f"INFO: No active Agent running to shut down.")
        sys.exit(0)

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

def is_agent_running() -> bool:
    """
    Checks if there's a running process of the Agent by trying to open its Named Mutex.
    Only applicable when running as compiled frozen binaries.
    """
    if not is_frozen():
        return False
    try:
        # Try to open the Agent's Named Mutex
        handle = win32event.OpenMutex(win32event.SYNCHRONIZE, False, "Local\\AutoPrintAgentMutex")
        win32api.CloseHandle(handle)
        return True
    except Exception:
        # OpenMutex fails (e.g. ERROR_FILE_NOT_FOUND) if the mutex doesn't exist
        return False

def acquire_launcher_mutex():
    """Ensures only a single instance of the launcher can run at any time."""
    global launcher_mutex
    try:
        launcher_mutex = win32event.CreateMutex(None, True, "Local\\AutoPrintLauncherMutex")
        if win32api.GetLastError() == winerror.ERROR_ALREADY_EXISTS:
            logger.info("Another Launcher instance is already running. Exiting.")
            sys.exit(0)
    except Exception as e:
        logger.warning(f"Failed to acquire launcher mutex: {e}")

def main():
    # 1. Handle graceful shutdown hook first
    check_shutdown_flag()

    # 2. Enforce single-instance for Launcher
    acquire_launcher_mutex()

    logger.info("=========================================")
    logger.info("       AutoPrint Launcher Booting        ")
    logger.info("=========================================")
    
    # 3. Retrieve config and check setup state
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
            
    # 4. Check if agent is already running (to prevent duplicate background agents)
    if is_agent_running():
        logger.info("Agent process is already running. Exiting launcher.")
        sys.exit(0)
        
    # 5. Launch Agent in the background and terminate launcher
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
