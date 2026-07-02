# AutoPrint - Production Deployment Guide

This document provides instructions for deploying AutoPrint to a production environment for pilot print shops.

---

## 1. Prerequisites & Environments

Before starting, ensure you have access to:
1. A **Supabase Account** (with a new or existing PostgreSQL database project).
2. A **Vercel Account** (or similar hosting provider) for the frontend React application.
3. A **Windows PC** (at the target print shop) connected to a physical USB/network printer.
4. **Inno Setup Compiler** installed on your development machine (if compiling the installer `.exe` from scratch).

---

## 2. Supabase Database Setup

### 2.1 Database Schema Initialization
Execute the SQL migration scripts in order using the Supabase SQL Editor:
1. `supabase_schema.sql`: Boots the core `shops` and `print_jobs` schemas.
2. `migration_v2.sql`: Configures multi-tenant agent polling and triggers.
3. `migration_v3.sql`: Configures 6-digit alphabetic-numeric `shop_code` columns.
4. `migration_v4.sql`: Extends metadata schema (color, duplex, nullable pages, and print mode settings).
5. `migration_v5.sql`: Implements state transition checking constraints to prevent unauthorized API requests.

### 2.2 Register a Shop
To register a pilot shop, run the following SQL command with the desired shop details:
```sql
INSERT INTO public.shops (name, shop_code, is_active, print_mode)
VALUES ('Kiosk Copy Center', 'KRL004', true, 'manual');
```
*Note down the generated shop UUID (e.g. `1bb3cb6a-869d-4c30-85d0-59992d7250e7`) for agent connection checks.*

---

## 3. Frontend Production Build & Deployment

### 3.1 Environment Configuration
Create a production environment file `frontend/.env.production` containing:
```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
VITE_AGENT_DOWNLOAD_URL=https://your-site.com/AutoPrintSetup.exe
```

### 3.2 Build Command
Build the React production assets:
```bash
npm run build
```
The production bundle will be generated under `frontend/dist`. Deploy this directory to Vercel, Netlify, or your preferred static hosting platform.

---

## 4. Desktop Agent Binary Compilation

### 4.1 PyInstaller Build
On a Windows machine with python installed:
1. Open terminal in `windows-agent/` directory.
2. Activate the virtual environment (`.venv`).
3. Run PyInstaller on the spec file:
   ```bash
   pyinstaller --noconfirm autoprint.spec
   ```
This compiles the background services and creates a distribution folder at `dist/AutoPrint`.

### 4.2 Installer Compilation (Inno Setup)
1. Open Inno Setup Compiler.
2. Load `windows-agent/autoprint_setup.iss`.
3. Click **Compile**.
4. The compiled installer wizard will be generated at `dist/AutoPrintSetup.exe`.
5. Upload this installer executable to the hosting location defined by `VITE_AGENT_DOWNLOAD_URL` in the frontend setup.

---

## 5. Shop Onboarding & Configuration

1. **Mount QR Code:** Open `/shop/<shop_id>` on the dashboard, print or download the generated QR code, and stick it at the checkout counter.
2. **Install Agent:** Run `AutoPrintSetup.exe` on the shopkeeper's PC.
3. **Onboarding Wizard:**
   - Input the shop code (e.g., `KRL004`) and click **Verify**.
   - Select the active printer from the dropdown menu (e.g. `HP LaserJet Pro`).
   - Print a test page to verify connectivity, then complete onboarding.
4. **Agent Autostart:** Confirm that the agent icon is visible in the Windows system tray. The agent will run silently in the background and start automatically on startup.
