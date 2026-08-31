-- Phase 4 hardening: public directions derive only from verified coordinates
-- and manual closures automatically expire.
BEGIN;

ALTER TABLE autoprint_v3.shop_locations
  ADD COLUMN IF NOT EXISTS manual_closed_until timestamptz;

-- Preserve existing closures briefly while ensuring old boolean-only overrides
-- cannot leave a shop closed indefinitely.
UPDATE autoprint_v3.shop_locations
SET manual_closed_until = now() + interval '12 hours'
WHERE manual_closed_override = true AND manual_closed_until IS NULL;

CREATE OR REPLACE FUNCTION autoprint_v3.find_nearby_shops(
  p_lat numeric, p_lng numeric, p_radius_km numeric DEFAULT 5.0,
  p_limit integer DEFAULT 20, p_offset integer DEFAULT 0,
  p_filter_remote_orders boolean DEFAULT false, p_filter_colour boolean DEFAULT false,
  p_filter_bw boolean DEFAULT false, p_filter_a3 boolean DEFAULT false,
  p_filter_duplex boolean DEFAULT false
)
RETURNS TABLE (
  shop_id uuid, shop_code text, name text, address_line text, locality text,
  pincode text, maps_url text, distance_km numeric, manual_closed_override boolean,
  timezone text, remote_orders_enabled boolean, remote_orders_paused boolean,
  bw_printing boolean, colour_printing boolean, a4_paper boolean,
  a3_paper boolean, duplex_printing boolean
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = autoprint_v3, public, extensions, pg_temp
AS $$
DECLARE
  v_rad_limit numeric := LEAST(GREATEST(p_radius_km, 0.5), 25.0);
  v_row_limit integer := LEAST(GREATEST(p_limit, 1), 50);
BEGIN
  RETURN QUERY
  WITH calculated AS (
    SELECT s.id AS c_shop_id, s.shop_code AS c_shop_code, s.name AS c_name,
      loc.address_line AS c_address_line, loc.locality AS c_locality,
      loc.pincode AS c_pincode,
      ('https://www.google.com/maps/dir/?api=1&destination=' ||
        loc.lat::text || '%2C' || loc.lng::text) AS c_maps_url,
      (loc.manual_closed_override AND loc.manual_closed_until > now()) AS c_manual_closed_override,
      loc.timezone AS c_timezone,
      ROUND((6371.0 * 2.0 * ASIN(SQRT(
        POWER(SIN(RADIANS((p_lat - loc.lat) / 2.0)), 2) +
        COS(RADIANS(p_lat)) * COS(RADIANS(loc.lat)) *
        POWER(SIN(RADIANS((p_lng - loc.lng) / 2.0)), 2)
      )))::numeric, 1) AS c_distance_km,
      COALESCE(rem.remote_orders_enabled, false) AS c_remote_orders_enabled,
      COALESCE(rem.remote_orders_paused, false) AS c_remote_orders_paused,
      COALESCE(cap.bw_printing, true) AS c_bw_printing,
      COALESCE(cap.colour_printing, false) AS c_colour_printing,
      COALESCE(cap.a4_paper, true) AS c_a4_paper,
      COALESCE(cap.a3_paper, false) AS c_a3_paper,
      COALESCE(cap.duplex_printing, false) AS c_duplex_printing
    FROM public.shops s
    INNER JOIN autoprint_v3.shop_locations loc ON loc.shop_id = s.id
    LEFT JOIN autoprint_v3.shop_remote_policies rem ON rem.shop_id = s.id
    LEFT JOIN autoprint_v3.shop_capabilities_public cap ON cap.shop_id = s.id
    WHERE s.is_active = true AND s.migration_mode IN ('v3_canary', 'v3_active')
      AND loc.discovery_enabled = true AND loc.lat IS NOT NULL AND loc.lng IS NOT NULL
  )
  SELECT c.c_shop_id, c.c_shop_code, c.c_name, c.c_address_line, c.c_locality,
    c.c_pincode, c.c_maps_url, c.c_distance_km, c.c_manual_closed_override,
    c.c_timezone, c.c_remote_orders_enabled, c.c_remote_orders_paused,
    c.c_bw_printing, c.c_colour_printing, c.c_a4_paper, c.c_a3_paper, c.c_duplex_printing
  FROM calculated c
  WHERE c.c_distance_km <= v_rad_limit
    AND (NOT p_filter_remote_orders OR (c.c_remote_orders_enabled AND NOT c.c_remote_orders_paused))
    AND (NOT p_filter_colour OR c.c_colour_printing)
    AND (NOT p_filter_bw OR c.c_bw_printing)
    AND (NOT p_filter_a3 OR c.c_a3_paper)
    AND (NOT p_filter_duplex OR c.c_duplex_printing)
  ORDER BY c.c_distance_km ASC LIMIT v_row_limit OFFSET p_offset;
END;
$$;

CREATE OR REPLACE FUNCTION autoprint_v3.set_shop_discovery_enabled(
  p_shop_id uuid, p_user_id uuid, p_enabled boolean,
  p_manual_closed_override boolean DEFAULT false
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = autoprint_v3, public, extensions, pg_temp
AS $$
DECLARE v_loc autoprint_v3.shop_locations%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM autoprint_v3.shop_memberships
    WHERE shop_id = p_shop_id AND user_id = p_user_id AND active AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Only shop owners can toggle discovery status' USING ERRCODE = 'P0073';
  END IF;
  INSERT INTO autoprint_v3.shop_locations (
    shop_id, discovery_enabled, manual_closed_override, manual_closed_until, updated_by_user_id, updated_at
  ) VALUES (
    p_shop_id, p_enabled, p_manual_closed_override,
    CASE WHEN p_manual_closed_override THEN now() + interval '12 hours' ELSE NULL END,
    p_user_id, now()
  ) ON CONFLICT (shop_id) DO UPDATE SET
    discovery_enabled = EXCLUDED.discovery_enabled,
    manual_closed_override = EXCLUDED.manual_closed_override,
    manual_closed_until = EXCLUDED.manual_closed_until,
    updated_by_user_id = EXCLUDED.updated_by_user_id, updated_at = now()
  RETURNING * INTO v_loc;
  INSERT INTO autoprint_v3.audit_events (
    shop_id, actor_type, actor_id, event_type, target_type, target_id, metadata_json
  ) VALUES (
    p_shop_id, 'shop_user', p_user_id, 'SHOP_DISCOVERY_TOGGLED', 'shop_locations', p_shop_id,
    jsonb_build_object('discovery_enabled', p_enabled, 'manual_closed_override', p_manual_closed_override,
      'manual_closed_until', v_loc.manual_closed_until)
  );
  RETURN to_jsonb(v_loc);
END;
$$;

GRANT EXECUTE ON FUNCTION
  autoprint_v3.find_nearby_shops(numeric, numeric, numeric, integer, integer, boolean, boolean, boolean, boolean, boolean),
  autoprint_v3.set_shop_discovery_enabled(uuid, uuid, boolean, boolean)
TO autoprint_api_role, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
