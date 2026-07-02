# 📋 Phase 1 Implementation Plan: Windows Print Agent MVP

This plan outlines the architecture, directory structure, assumptions, and validation metrics for the first milestone of our rebuilt smart printing system.

---

## 🛠️ Directory Structure

We will create a clean module layout in a new `desktop-agent/` directory inside your workspace:

```
f:/Projects/Printer automation/desktop-agent/
├── bin/                       # Holds SumatraPDF.exe (in real mode)
├── config.py                  # Runtime settings, simulator flags, directories
├── print_executor.py          # Abstract PrintExecutor (Simulation vs. SumatraPDF)
├── queue_listener.py          # Abstract QueueListener (Local Watched Folder)
├── agent.py                   # Main loop coordinator & cleanup
├── test_trigger.py            # Helper script to simulate creating jobs
├── requirements.txt           # Minimal pip dependencies (pywin32)
└── README.md                  # Run and verification instructions
```

---

## 🔍 Confirmed Assumptions

1. **Host Environment**: Windows OS with Python 3.8+ installed.
2. **Abstract Queue Source**: The agent reads jobs from a local watched directory. Job instructions are written as small JSON metadata files (e.g., `job_123.json`) referencing a companion PDF file. This abstract interface allows swapping in a Firebase listener in Phase 2 without rewriting the core loop.
3. **Execution Modes**:
   * **Test/Simulation Mode**: No physical printer is queried or invoked. The execution outputs detailed console statements and logs the print parameters.
   * **Real Mode**: Uses the local Windows Default Printer (queried via `win32print`) and spawns a headless SumatraPDF CLI command to print.
4. **Clean Termination & Purging**: The agent automatically deletes downloaded PDF files and JSON tasks from the temp/watched directories upon completion or failure.

---

## 🚀 Execution Roadmap

*   **Step 1**: Write `config.py` and `requirements.txt` to handle folders and configurations.
*   **Step 2**: Implement the abstract queue system in `queue_listener.py`.
*   **Step 3**: Implement `print_executor.py` with both Simulator and SumatraPDF backends.
*   **Step 4**: Build the central execution coordinator in `agent.py` with logging and error handling.
*   **Step 5**: Write `test_trigger.py` to allow easy testing.
*   **Step 6**: Provide detailed verify instructions.
