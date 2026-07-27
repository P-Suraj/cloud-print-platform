-- ============================================================
-- AutoPrint: Performance Indexes
-- Run once in Supabase SQL Editor
-- ============================================================

-- 1. Fastest lookup path: shop_code (used on every URL load)
--    e.g. SELECT * FROM shops WHERE shop_code = 'TST001'
CREATE INDEX IF NOT EXISTS idx_shops_shop_code
  ON public.shops (shop_code);

-- 2. Most common query: jobs for a shop filtered by status
--    e.g. SELECT * FROM print_jobs WHERE shop_id = '...' ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_print_jobs_shop_id_created
  ON public.print_jobs (shop_id, created_at DESC);

-- 3. Job status queries (agent claiming, console filtering)
--    e.g. SELECT * FROM print_jobs WHERE shop_id = '...' AND status = 'queued'
CREATE INDEX IF NOT EXISTS idx_print_jobs_shop_status
  ON public.print_jobs (shop_id, status);

-- 4. Heartbeat freshness check on every console load
--    e.g. SELECT last_seen_at FROM shops WHERE id = '...'
CREATE INDEX IF NOT EXISTS idx_shops_last_seen_at
  ON public.shops (last_seen_at DESC);

-- 5. Events/telemetry lookup per shop
CREATE INDEX IF NOT EXISTS idx_events_shop_id
  ON public.events (shop_id, created_at DESC);

-- ============================================================
-- OPTIONAL: Row Level Security (prevents cross-shop data leaks)
-- Only enable if you add auth tokens per shop later.
-- ALTER TABLE public.print_jobs ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.shops ENABLE ROW LEVEL SECURITY;
-- ============================================================
