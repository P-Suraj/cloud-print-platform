-- Migration 0004: Canary Backfill and Migration Mode Setup
-- Target Namespace: autoprint_v3 & public.shops

BEGIN;

-- 1. Add migration_mode Column to public.shops (Default: 'legacy')
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'shops' AND column_name = 'migration_mode'
  ) THEN
    ALTER TABLE public.shops 
      ADD COLUMN migration_mode autoprint_v3.migration_mode NOT NULL DEFAULT 'legacy';
  END IF;
END $$;

-- 2. Backfill Canary Shop Initial Rate Card (Canary UUID: c0a80001-0000-0000-0000-000000000001 or matching CANARY01)
DO $$
DECLARE
  v_canary_shop_id uuid;
  v_owner_user_id uuid;
  v_owner_auth_id uuid;
  v_owner_email text := current_setting('autoprint.canary_owner_email', true);
BEGIN
  -- Resolve canary shop ID from public.shops if it exists, otherwise create placeholder entry for canary
  SELECT id INTO v_canary_shop_id FROM public.shops WHERE shop_code = 'CANARY01' LIMIT 1;

  -- CANARY01 must already exist as a verified shop in public.shops.
  -- This migration does NOT create placeholder shops.
  -- If the canary shop is absent, fail loudly so the operator creates
  -- the verified shop record before re-running.
  IF v_canary_shop_id IS NULL THEN
    RAISE EXCEPTION
      'CANARY01 shop not found in public.shops — create the verified canary '
      'shop record in public.shops before running migration 0004. '
      'Do NOT insert a placeholder here.'
      USING ERRCODE = 'P0006';
  END IF;


  IF v_canary_shop_id IS NOT NULL THEN
    IF v_owner_email IS NULL OR length(trim(v_owner_email)) = 0 THEN
      RAISE EXCEPTION 'autoprint.canary_owner_email must be set to a verified Supabase Auth user';
    END IF;

    SELECT id INTO v_owner_auth_id
    FROM auth.users
    WHERE lower(email) = lower(v_owner_email)
    LIMIT 1;

    IF v_owner_auth_id IS NULL THEN
      RAISE EXCEPTION 'No Supabase Auth user exists for canary owner email %', v_owner_email;
    END IF;

    -- Link the application profile to the verified Supabase Auth identity.
    INSERT INTO autoprint_v3.users (identity_provider, identity_subject, email, display_name)
    VALUES ('supabase', v_owner_auth_id::text, v_owner_email, 'Canary Shop Owner')
    ON CONFLICT (identity_provider, identity_subject) DO UPDATE SET updated_at = now()
    RETURNING id INTO v_owner_user_id;

    -- Ensure canary owner membership exists
    INSERT INTO autoprint_v3.shop_memberships (shop_id, user_id, role, active)
    VALUES (v_canary_shop_id, v_owner_user_id, 'owner', true)
    ON CONFLICT (shop_id, user_id) DO NOTHING;

    -- Insert Version 1 Initial Rate Card for Canary Shop
    INSERT INTO autoprint_v3.rate_cards (shop_id, version, currency, rules_json, created_by_user_id)
    VALUES (
      v_canary_shop_id,
      1,
      'INR',
      '{
        "bw_simplex_slabs": [{"min_pages": 1, "max_pages": 10, "rate": 2.00}, {"min_pages": 11, "max_pages": 9999, "rate": 1.50}],
        "bw_duplex_slabs": [{"min_pages": 1, "max_pages": 10, "rate": 1.50}, {"min_pages": 11, "max_pages": 9999, "rate": 1.25}],
        "color_simplex_slabs": [{"min_pages": 1, "max_pages": 5, "rate": 10.00}, {"min_pages": 6, "max_pages": 9999, "rate": 8.00}],
        "color_duplex_slabs": [{"min_pages": 1, "max_pages": 5, "rate": 8.00}, {"min_pages": 6, "max_pages": 9999, "rate": 6.00}]
      }'::jsonb,
      v_owner_user_id
    )
    ON CONFLICT (shop_id, version) DO NOTHING;
  END IF;
END $$;

COMMIT;
