# 🖨️ AutoPrint Windows Desktop Agent (Phase 1)

A lightweight, modular Python background print connector for Windows.

---

## 🛠️ Setup Instructions

### 1. Python Environment
Make sure you have Python 3.8+ installed on your system.

Navigate to the agent directory and install dependencies (for native printer detection):
```bash
pip install -r requirements.txt
```

---

## 🧪 Running in Simulation Mode (Recommended First Test)

By default, the agent is configured in **Simulation Mode** (`SIMULATION_MODE = True` in `config.py`). It does not require a physical printer or any native binaries.

### Step 1: Start the Agent
In a terminal window:
```bash
python agent.py
```
You should see:
```text
=========================================
    🖨️  AutoPrint Windows Agent Started   
=========================================
Mode: SIMULATION
Watch Directory: ...\windows-agent\queue
Temp Directory: ...\windows-agent\temp
Default Printer: MOCK_PRINTER_SYSTEM
Press Ctrl+C to exit gracefully.
```

### Step 2: Trigger a Test Job (In a separate terminal)
Run the helper test script:
```bash
python test_trigger.py
```
This script writes:
1. A valid minimal PDF file into the `queue/` folder.
2. A matching `job_<id>.json` file with `status: "queued"`.

### Step 3: Observe Status Lifecycle
* The agent console logs will print status changes:
  1. Found job -> updates state to `printing`.
  2. Copies file to isolated temp folder.
  3. Simulates printing (waits 3 seconds).
  4. Deletes temp PDF and deletes original source PDF (privacy purge).
  5. Updates `job_<id>.json` status to `completed`.
* Open `queue/job_<id>.json` in your editor to verify that `"status": "completed"` is recorded.

---

## 🖨️ Running in Real Printer Mode

To test printing on a physical Windows USB or network printer:

1. **Get SumatraPDF.exe**:
   * Download the portable version of [SumatraPDF 3.5+](https://www.sumatrapdfreader.org/free-pdf-reader).
   * Save the executable as `SumatraPDF.exe` inside the `windows-agent/sumatrapdf/` folder.

2. **Configure Config**:
   * Open `config.py`.
   * Set `SIMULATION_MODE = False`.

3. **Run the Agent**:
   * Run `python agent.py`.
   * The agent will query Windows for the default system printer and display its name.
   * Trigger a job with `python test_trigger.py` and verify it prints silently to your default printer without showing any popups.
