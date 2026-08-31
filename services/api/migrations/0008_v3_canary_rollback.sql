-- Migration 0008: v3 Canary Rollback
-- PURPOSE: Safely routes the single verified canary shop back to legacy.
-- 
-- This migration intentionally preserves autoprint_v3 schema objects, roles,
-- jobs, attempts, transitions and audit history.
--
-- Safety guard: raises an exception if any non-terminal print_jobs exist.

BEGIN;

-- 1. Safety guard: abort if any live jobs exist
DO $$
DECLARE
  live_count integer;
BEGIN
  SELECT COUNT(*) INTO live_count
  FROM autoprint_v3.print_jobs
  WHERE shop_id = (
      SELECT id FROM public.shops WHERE shop_code = 'CANARY01' LIMIT 1
    )
    AND status NOT IN ('completed', 'rejected', 'failed', 'cancelled');

  IF live_count > 0 THEN
    RAISE EXCEPTION
      'ROLLBACK BLOCKED: % active print_job(s) found in autoprint_v3. '
      'Resolve all outstanding jobs before running this rollback migration.',
      live_count
      USING ERRCODE = 'P0007';
  END IF;
END $$;

-- 2. Route only the canary shop to the legacy listener.
DO $$
DECLARE
  updated_count integer;
BEGIN
  UPDATE public.shops
  SET migration_mode = 'legacy'
  WHERE shop_code = 'CANARY01'
    AND migration_mode IN ('v3_canary', 'rollback_pending');
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count != 1 THEN
    RAISE EXCEPTION 'CANARY01 was not in a rollback-eligible migration mode';
  END IF;
END $$;

COMMIT;
