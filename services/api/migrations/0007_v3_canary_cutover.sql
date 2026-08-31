-- Migration 0007: v3 Canary Shop Cutover
-- Switches CANARY01 shop to v3_canary migration_mode while leaving legacy shops on legacy mode.

BEGIN;

DO $$
DECLARE
  updated_count integer;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.shops
    WHERE shop_code != 'CANARY01' AND migration_mode != 'legacy'
  ) THEN
    RAISE EXCEPTION 'Cutover blocked: a non-canary shop is not in legacy mode';
  END IF;

  UPDATE public.shops
  SET migration_mode = 'v3_canary'
  WHERE shop_code = 'CANARY01' AND migration_mode = 'legacy';
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count != 1 THEN
    RAISE EXCEPTION 'Cutover requires exactly one legacy CANARY01 shop';
  END IF;
END $$;

-- Assert non-canary shops remain legacy
SELECT shop_code, migration_mode FROM public.shops;

COMMIT;
