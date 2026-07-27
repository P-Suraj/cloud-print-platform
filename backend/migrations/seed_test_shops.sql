-- ============================================================
-- AutoPrint: Seed Test Shop Codes (TST001 & TST002) for Supabase
-- Valid UUID v4 Hex Strings for PostgreSQL UUID Column Type
-- ============================================================

-- 1. Ensure pin column exists on public.shops table
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS pin TEXT DEFAULT '1234';

-- 2. Insert Test Hub 1 and Test Hub 2 with valid Hex UUIDs
INSERT INTO public.shops (id, name, shop_code, pin, print_mode, printer_bw, printer_color, is_active)
VALUES 
  ('11111111-1111-4111-8111-111111111111', 'Test Hub 1 (Beta Kiosk)', 'TST001', '1234', 'manual', NULL, NULL, true),
  ('22222222-2222-4222-8222-222222222222', 'Test Hub 2 (Lab Kiosk)', 'TST002', '1234', 'auto', NULL, NULL, true)
ON CONFLICT (id) DO NOTHING;
