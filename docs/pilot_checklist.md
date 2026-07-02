# AutoPrint - Pilot Deployment Checklist

This document provides a complete guide for deploying AutoPrint in a new pilot print shop. Follow these steps in order.

---

## 1. Database Setup (Supabase)

### 1.1 Execute Schema Migrations
Run these migration files in order inside the Supabase SQL Editor:
1. `supabase_schema.sql` (Creates core tables: `shops`, `print_jobs`)
2. `migration_v2.sql` (Adds `last_seen_at` column and multi-tenant `claim_next_job` RPC function)
3. `migration_v3.sql` (Adds `shop_code` text column and index)
4. `migration_v4.sql` (Adds `print_mode`, `color_mode`, `duplex` columns, makes `page_count` nullable, and registers status check update policies)
5. `migration_v5.sql` (Adds security state transition checker helper function and locks down RLS update policy for print jobs)

### 1.2 Verification / Rollback Notes
- Verify tables exist: `shops` and `print_jobs`.
- Verify database RPC function `claim_next_job` and `update_shop_print_mode` exist.
- **Rollback:** In case of emergency schema failure, you can drop tables using:
  ```sql
  DROP TABLE IF EXISTS public.print_jobs CASCADE;
  DROP TABLE IF EXISTS public.shops CASCADE;
  ```

---

## 2. Shop Kiosk Setup (Database Records)

1. Insert a new shop row in the `shops` table. Make sure to generate a unique shop code matching format `^[A-Z]{3}\d{3}$` (e.g. `ABC102`):
   ```sql
   INSERT INTO public.shops (name, shop_code, is_active)
   VALUES ('Pilot Shop Name', 'ABC102', true);
   ```
2. Retrieve the generated shop UUID (e.g. `shop_id` value) for agent configuration.

---

## 3. Frontend Web App Deployment (Vercel)

### 3.1 Environment Variables
Configure the following environment parameters on Vercel deployment:
- `VITE_SUPABASE_URL`: Supabase project URL (e.g. `https://xxx.supabase.co`).
- `VITE_SUPABASE_ANON_KEY`: Supabase project public anonymous key.
- `VITE_AGENT_DOWNLOAD_URL`: Confgured download link for the setup wizard client installer (e.g. `https://example.com/AutoPrintSetup.exe`).

### 3.2 Deployment
- Push local repository or build production folder via `npm run build` and link Vercel workspace to deploy.

---

## 4. Desktop Print Client Setup (Shopkeeper's Windows PC)

### 4.1 Prerequisites
- Ensure the shopkeeper's PC is running Windows (Windows 10/11) and is connected to the physical printer.
- Confirm the target printer is set as default or note down its exact name in Windows Control Panel (e.g. `HP LaserJet Pro MFP M227`).

### 4.2 Installation and Wizard
1. Download and run the `AutoPrintSetup.exe` installer on the target machine.
2. The installer will automatically run the setup wizard.
3. **Connection Configuration:**
   - Input the unique **Shop Code** (`ABC102`) generated in Step 2.
   - Click "Verify Shop Code" to resolve connection and display resolved shop name.
4. **Printer Selection:**
   - Select the target Windows printer name from the list.
   - (For first-run setup) Select "Print Test Page" checkbox to verify print commands are successfully spooled.
   - Bypass test print for settings reconfigurations.
5. **Autostart:** The agent registers under user registry keys to autostart automatically on system reboot.

---

## 5. Kiosk QR Setup

1. Open the Shop Dashboard page (`/shop/<shop_id>`) in the browser.
2. Verify the shop code displays correctly.
3. Download or print the generated QR Code canvas displaying on the card.
4. Mount the printed QR code sheet at the shop counter.
5. Customers scan the QR code to open the customer portal URL with auto-connection param: `?shop=ABC102`.

---

## 6. Verification and Smoke Testing Checklist

Run these test actions to confirm success:
- [ ] **Agent Heartbeat:** Verify dashboard shows `🟢 Agent Online` (proves background polling and connection are healthy).
- [ ] **Manual Approval Flow:** Submit a document via customer portal. Verify it appears under "Pending Approval". Click "Approve". Verify agent spools and prints the file, status changes to "Completed".
- [ ] **Manual Rejection Flow:** Submit a document, click "Reject" on the dashboard. Verify job changes to "Rejected" status and agent ignores it.
- [ ] **Auto Print Flow:** Change print mode toggle to "Auto Print". Submit a document. Verify it prints directly without manual dashboard interaction.
- [ ] **Retry Action:** Disconnect printer USB (or pause print spooler) to simulate failure. Wait for status "Failed". Reconnect, click "Retry" on dashboard, and confirm it prints.
