# AutoPrint - Troubleshooting Guide

This guide outlines common issues that may occur during AutoPrint kiosk and agent deployments, along with clear diagnostic steps and resolutions.

---

## 1. Dashboard Displays "Agent Offline"

### Symptom:
The dashboard shows `🔴 Agent Offline` even though the shop PC is powered on.

### Causes & Resolutions:
1. **Agent Process is Not Running:**
   - Check the Windows System Tray (bottom right corner). Look for the AutoPrint printer tray icon.
   - If missing, double-click the **AutoPrint** shortcut on the Desktop or Start Menu to launch it.
2. **Invalid Shop Configuration:**
   - Right-click the system tray icon, select **Configure Agent Settings** (launches setup wizard).
   - Verify that the Shop Code resolves successfully to the correct shop name.
3. **Network Connection Interruptions:**
   - Verify that the shop computer has a working internet connection.
   - Check the log file `C:\Users\<username>\AppData\Local\AutoPrint\logs\agent.log` for database timeout errors.
   - Ensure firewall/antivirus does not block connection to your Supabase host (ports 80 / 443).

---

## 2. Print Job Fails (Spooler Errors / Status "Failed")

### Symptom:
A print job arrives on the dashboard, status changes to `Printing`, then changes to `Failed` with red info indicators.

### Causes & Resolutions:
1. **Printer is Offline or Disconnected:**
   - Verify that the physical USB or network cable connecting the printer is plugged in.
   - Open Windows **Settings > Bluetooth & devices > Printers & scanners**. Verify the selected printer does not say "Offline" or "Paused".
2. **Invalid Printer Selected in Wizard:**
   - Launch the setup wizard (tray menu -> Configure Agent Settings).
   - Ensure the selected printer matches the exact name of the physical printer in Windows.
3. **Spooler Service Crashed:**
   - Restart the Windows Print Spooler service:
     1. Open the Start menu, type `services.msc` and press Enter.
     2. Locate **Print Spooler** in the list.
     3. Right-click and select **Restart**.
4. **SumatraPDF Missing or Blocked:**
   - The agent requires `SumatraPDF.exe` (located under program internal directory) to execute silent printing. Verify the file has not been quarantined by antivirus software.
   - Check `agent.log` for specific SumatraPDF command execution errors.

---

## 3. Realtime Dashboard Does Not Sync Instantly

### Symptom:
New jobs or status changes do not appear on the kiosk dashboard without manually refreshing the browser.

### Causes & Resolutions:
1. **Supabase Realtime is Disabled:**
   - Open the Supabase Console.
   - Navigate to **Database > Replication**.
   - Under **Source**, select the `supabase_realtime` publication.
   - Ensure the `print_jobs` table is added to replication (toggle replication switch). If disabled, Supabase will not broadcast updates to listeners.
2. **Subscription Error:**
   - Open browser developer tools (F12) on the Shop dashboard.
   - Look at the console for WebSocket or Supabase subscription connection errors.

---

## 4. Unknown Page Counts

### Symptom:
A customer uploads a PDF, and the dashboard shows "Unknown" pages under the job info.

### Causes & Resolutions:
1. **Password-Protected PDF:**
   - The client-side PDF.js reader cannot extract page counts from password-protected files. AutoPrint allows submission as "Unknown" rather than failing, but the printer manager will print it based on the document's actual layout pages.
2. **CDN Library Blocked:**
   - The page counter requires downloading `pdf.min.js` from `cdnjs.cloudflare.com` on mount. If the customer's phone has no internet access or is blocking the CDN, page extraction will fall back gracefully to `Unknown` pages.

---

## 5. Antivirus / Windows Defender Warnings on Installation

### Symptom:
When running `AutoPrintSetup.exe`, Windows Defender shows "SmartScreen prevented an unrecognized app from starting."

### Causes & Resolutions:
1. **Unsigned Executable Warning:**
   - Since the pilot installer binary is self-compiled and unsigned, Windows warns the user.
   - Click **More info**, then click **Run anyway** to proceed.
   - The installer automatically executes a PowerShell script to whitelist the application folder (`{localappdata}\Programs\AutoPrint`) in Windows Defender to prevent active quarantine blocks during runtime.
