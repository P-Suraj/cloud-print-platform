-- ============================================================
-- AutoPrint: Seed Test Shop Codes (TST001 & TST002) for Supabase
-- Printer destinations left blank until auto-detected by Windows Agent setup
-- ============================================================

INSERT INTO public.shops (id, name, shop_code, pin, print_mode, printer_bw, printer_color, is_active)
VALUES 
  ('tst001-0000-0000-0000-000000000001', 'Test Hub 1 (Beta Kiosk)', 'TST001', '1234', 'manual', NULL, NULL, true),
  ('tst002-0000-0000-0000-000000000002', 'Test Hub 2 (Lab Kiosk)', 'TST002', '1234', 'auto', NULL, NULL, true)
ON CONFLICT (id) DO NOTHING;
