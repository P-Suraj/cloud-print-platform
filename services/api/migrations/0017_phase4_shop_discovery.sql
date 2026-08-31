-- Migration 0017: Phase 4 — Nearby-Shop Discovery List and Directions
-- Adds tables for shop locations, operating hours, date exceptions, and public capability flags.
-- Implements pure SQL haversine distance calculation and security-definer RPCs for discovery.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. SHOP LOCATIONS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE autoprint_v3.shop_locations (
  shop_id                  uuid           PRIMARY KEY REFERENCES public.shops(id) ON DELETE CASCADE,
  discovery_enabled        boolean        NOT NULL DEFAULT false,
  lat                      numeric(10, 7) CHECK (lat IS NULL OR (lat >= -90.0 AND lat <= 90.0)),
  lng                      numeric(10, 7) CHECK (lng IS NULL OR (lng >= -180.0 AND lng <= 180.0)),
  address_line             text,
  locality                 text,
  pincode                  text           CHECK (pincode IS NULL OR length(trim(pincode)) BETWEEN 4 AND 10),
  maps_url                 text,
  maps_url_validated_at   timestamptz,
  timezone                 text           NOT NULL DEFAULT 'Asia/Kolkata',
  manual_closed_override   boolean        NOT NULL DEFAULT false,
  updated_by_user_id       uuid           REFERENCES autoprint_v3.users(id),
  created_at               timestamptz    NOT NULL DEFAULT now(),
  updated_at               timestamptz    NOT NULL DEFAULT now()
);

CREATE INDEX idx_shop_locations_discovery ON autoprint_v3.shop_locations(discovery_enabled)
  WHERE discovery_enabled = true;
CREATE INDEX idx_shop_locations_locality ON autoprint_v3.shop_locations(locality);
CREATE INDEX idx_shop_locations_pincode ON autoprint_v3.shop_locations(pincode);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. SHOP OPERATING HOURS (Weekly Schedule: 0=Sunday ... 6=Saturday)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE autoprint_v3.shop_hours (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id      uuid        NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  day_of_week  smallint    NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  opens_at     time,
  closes_at    time,
  is_closed    boolean     NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shop_hours_shop_dow_unique UNIQUE (shop_id, day_of_week),
  CONSTRAINT shop_hours_valid_times CHECK (
    is_closed = true OR (opens_at IS NOT NULL AND closes_at IS NOT NULL)
  )
);

CREATE INDEX idx_shop_hours_shop_dow ON autoprint_v3.shop_hours(shop_id, day_of_week);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. SHOP OPERATING HOUR EXCEPTIONS (Holidays / Special Dates)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE autoprint_v3.shop_hour_exceptions (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id        uuid        NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  exception_date date        NOT NULL,
  is_closed      boolean     NOT NULL DEFAULT true,
  opens_at       time,
  closes_at      time,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shop_exceptions_shop_date_unique UNIQUE (shop_id, exception_date),
  CONSTRAINT shop_exceptions_valid_times CHECK (
    is_closed = true OR (opens_at IS NOT NULL AND closes_at IS NOT NULL)
  )
);

CREATE INDEX idx_shop_exceptions_lookup ON autoprint_v3.shop_hour_exceptions(shop_id, exception_date);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. SHOP PUBLIC CAPABILITIES
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE autoprint_v3.shop_capabilities_public (
  shop_id          uuid        PRIMARY KEY REFERENCES public.shops(id) ON DELETE CASCADE,
  bw_printing      boolean     NOT NULL DEFAULT true,
  colour_printing  boolean     NOT NULL DEFAULT false,
  a4_paper         boolean     NOT NULL DEFAULT true,
  a3_paper         boolean     NOT NULL DEFAULT false,
  duplex_printing  boolean     NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RLS POLICIES & GRANTS
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE autoprint_v3.shop_locations            ENABLE ROW LEVEL SECURITY;
ALTER TABLE autoprint_v3.shop_hours                ENABLE ROW LEVEL SECURITY;
ALTER TABLE autoprint_v3.shop_hour_exceptions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE autoprint_v3.shop_capabilities_public  ENABLE ROW LEVEL SECURITY;

CREATE POLICY api_rls_shop_locations ON autoprint_v3.shop_locations
  FOR ALL TO autoprint_api_role USING (true) WITH CHECK (true);
CREATE POLICY svc_rls_shop_locations ON autoprint_v3.shop_locations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY api_rls_shop_hours ON autoprint_v3.shop_hours
  FOR ALL TO autoprint_api_role USING (true) WITH CHECK (true);
CREATE POLICY svc_rls_shop_hours ON autoprint_v3.shop_hours
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY api_rls_shop_hour_exceptions ON autoprint_v3.shop_hour_exceptions
  FOR ALL TO autoprint_api_role USING (true) WITH CHECK (true);
CREATE POLICY svc_rls_shop_hour_exceptions ON autoprint_v3.shop_hour_exceptions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY api_rls_shop_capabilities ON autoprint_v3.shop_capabilities_public
  FOR ALL TO autoprint_api_role USING (true) WITH CHECK (true);
CREATE POLICY svc_rls_shop_capabilities ON autoprint_v3.shop_capabilities_public
  FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT SELECT,INSERT,UPDATE,DELETE ON
  autoprint_v3.shop_locations,
  autoprint_v3.shop_hours,
  autoprint_v3.shop_hour_exceptions,
  autoprint_v3.shop_capabilities_public
TO autoprint_api_role;

GRANT ALL ON
  autoprint_v3.shop_locations,
  autoprint_v3.shop_hours,
  autoprint_v3.shop_hour_exceptions,
  autoprint_v3.shop_capabilities_public
TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. RPC: find_nearby_shops
--    Performs pure-SQL haversine distance filtering and returns safe public fields.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION autoprint_v3.find_nearby_shops(
  p_lat numeric,
  p_lng numeric,
  p_radius_km numeric DEFAULT 5.0,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0,
  p_filter_remote_orders boolean DEFAULT false,
  p_filter_colour boolean DEFAULT false,
  p_filter_bw boolean DEFAULT false,
  p_filter_a3 boolean DEFAULT false,
  p_filter_duplex boolean DEFAULT false
)
RETURNS TABLE (
  shop_id uuid,
  shop_code text,
  name text,
  address_line text,
  locality text,
  pincode text,
  maps_url text,
  distance_km numeric,
  manual_closed_override boolean,
  timezone text,
  remote_orders_enabled boolean,
  remote_orders_paused boolean,
  bw_printing boolean,
  colour_printing boolean,
  a4_paper boolean,
  a3_paper boolean,
  duplex_printing boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = autoprint_v3, public, extensions, pg_temp
AS $$
DECLARE
  v_rad_limit numeric := LEAST(GREATEST(p_radius_km, 0.5), 25.0);
  v_row_limit integer := LEAST(GREATEST(p_limit, 1), 50);
BEGIN
  RETURN QUERY
  WITH calculated AS (
    SELECT
      s.id AS c_shop_id,
      s.shop_code AS c_shop_code,
      s.name AS c_name,
      loc.address_line AS c_address_line,
      loc.locality AS c_locality,
      loc.pincode AS c_pincode,
      loc.maps_url AS c_maps_url,
      loc.manual_closed_override AS c_manual_closed_override,
      loc.timezone AS c_timezone,
      ROUND((
        6371.0 * 2.0 * ASIN(
          SQRT(
            POWER(SIN(RADIANS((p_lat - loc.lat) / 2.0)), 2) +
            COS(RADIANS(p_lat)) * COS(RADIANS(loc.lat)) *
            POWER(SIN(RADIANS((p_lng - loc.lng) / 2.0)), 2)
          )
        )
      )::numeric, 1) AS c_distance_km,
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
    WHERE s.is_active = true
      AND s.migration_mode IN ('v3_canary', 'v3_active')
      AND loc.discovery_enabled = true
      AND loc.lat IS NOT NULL
      AND loc.lng IS NOT NULL
  )
  SELECT
    c.c_shop_id,
    c.c_shop_code,
    c.c_name,
    c.c_address_line,
    c.c_locality,
    c.c_pincode,
    c.c_maps_url,
    c.c_distance_km,
    c.c_manual_closed_override,
    c.c_timezone,
    c.c_remote_orders_enabled,
    c.c_remote_orders_paused,
    c.c_bw_printing,
    c.c_colour_printing,
    c.c_a4_paper,
    c.c_a3_paper,
    c.c_duplex_printing
  FROM calculated c
  WHERE c.c_distance_km <= v_rad_limit
    AND (NOT p_filter_remote_orders OR (c.c_remote_orders_enabled AND NOT c.c_remote_orders_paused))
    AND (NOT p_filter_colour OR c.c_colour_printing)
    AND (NOT p_filter_bw OR c.c_bw_printing)
    AND (NOT p_filter_a3 OR c.c_a3_paper)
    AND (NOT p_filter_duplex OR c.c_duplex_printing)
  ORDER BY c.c_distance_km ASC
  LIMIT v_row_limit
  OFFSET p_offset;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. RPC: set_shop_location
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION autoprint_v3.set_shop_location(
  p_shop_id uuid,
  p_user_id uuid,
  p_lat numeric,
  p_lng numeric,
  p_address_line text,
  p_locality text,
  p_pincode text,
  p_maps_url text,
  p_timezone text DEFAULT 'Asia/Kolkata'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = autoprint_v3, public, extensions, pg_temp
AS $$
DECLARE
  v_loc autoprint_v3.shop_locations%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM autoprint_v3.shop_memberships
    WHERE shop_id = p_shop_id AND user_id = p_user_id
      AND active AND role IN ('owner', 'staff')
  ) THEN
    RAISE EXCEPTION 'Unauthorized to manage shop location' USING ERRCODE = 'P0070';
  END IF;

  IF p_lat IS NOT NULL AND (p_lat < -90.0 OR p_lat > 90.0) THEN
    RAISE EXCEPTION 'Latitude must be between -90 and 90' USING ERRCODE = 'P0071';
  END IF;
  IF p_lng IS NOT NULL AND (p_lng < -180.0 OR p_lng > 180.0) THEN
    RAISE EXCEPTION 'Longitude must be between -180 and 180' USING ERRCODE = 'P0072';
  END IF;

  INSERT INTO autoprint_v3.shop_locations (
    shop_id, lat, lng, address_line, locality, pincode, maps_url,
    maps_url_validated_at, timezone, updated_by_user_id, updated_at
  ) VALUES (
    p_shop_id, p_lat, p_lng, p_address_line, p_locality, p_pincode, p_maps_url,
    CASE WHEN p_maps_url IS NOT NULL THEN now() ELSE NULL END,
    COALESCE(p_timezone, 'Asia/Kolkata'), p_user_id, now()
  )
  ON CONFLICT (shop_id) DO UPDATE
    SET lat                   = EXCLUDED.lat,
        lng                   = EXCLUDED.lng,
        address_line          = EXCLUDED.address_line,
        locality              = EXCLUDED.locality,
        pincode               = EXCLUDED.pincode,
        maps_url              = EXCLUDED.maps_url,
        maps_url_validated_at = EXCLUDED.maps_url_validated_at,
        timezone              = EXCLUDED.timezone,
        updated_by_user_id    = EXCLUDED.updated_by_user_id,
        updated_at            = now()
  RETURNING * INTO v_loc;

  INSERT INTO autoprint_v3.audit_events (
    shop_id, actor_type, actor_id, event_type, target_type, target_id, metadata_json
  ) VALUES (
    p_shop_id, 'shop_user', p_user_id, 'SHOP_LOCATION_UPDATED', 'shop_locations', p_shop_id,
    jsonb_build_object('locality', p_locality, 'has_coords', (p_lat IS NOT NULL AND p_lng IS NOT NULL))
  );

  RETURN to_jsonb(v_loc);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. RPC: set_shop_discovery_enabled
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION autoprint_v3.set_shop_discovery_enabled(
  p_shop_id uuid,
  p_user_id uuid,
  p_enabled boolean,
  p_manual_closed_override boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = autoprint_v3, public, extensions, pg_temp
AS $$
DECLARE
  v_loc autoprint_v3.shop_locations%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM autoprint_v3.shop_memberships
    WHERE shop_id = p_shop_id AND user_id = p_user_id
      AND active AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Only shop owners can toggle discovery status' USING ERRCODE = 'P0073';
  END IF;

  INSERT INTO autoprint_v3.shop_locations (
    shop_id, discovery_enabled, manual_closed_override, updated_by_user_id, updated_at
  ) VALUES (
    p_shop_id, p_enabled, p_manual_closed_override, p_user_id, now()
  )
  ON CONFLICT (shop_id) DO UPDATE
    SET discovery_enabled      = EXCLUDED.discovery_enabled,
        manual_closed_override = EXCLUDED.manual_closed_override,
        updated_by_user_id     = EXCLUDED.updated_by_user_id,
        updated_at             = now()
  RETURNING * INTO v_loc;

  INSERT INTO autoprint_v3.audit_events (
    shop_id, actor_type, actor_id, event_type, target_type, target_id, metadata_json
  ) VALUES (
    p_shop_id, 'shop_user', p_user_id, 'SHOP_DISCOVERY_TOGGLED', 'shop_locations', p_shop_id,
    jsonb_build_object('discovery_enabled', p_enabled, 'manual_closed_override', p_manual_closed_override)
  );

  RETURN to_jsonb(v_loc);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. RPC: set_shop_capabilities
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION autoprint_v3.set_shop_capabilities(
  p_shop_id uuid,
  p_user_id uuid,
  p_bw boolean,
  p_colour boolean,
  p_a4 boolean,
  p_a3 boolean,
  p_duplex boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = autoprint_v3, public, extensions, pg_temp
AS $$
DECLARE
  v_cap autoprint_v3.shop_capabilities_public%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM autoprint_v3.shop_memberships
    WHERE shop_id = p_shop_id AND user_id = p_user_id
      AND active AND role IN ('owner', 'staff')
  ) THEN
    RAISE EXCEPTION 'Unauthorized to manage shop capabilities' USING ERRCODE = 'P0074';
  END IF;

  INSERT INTO autoprint_v3.shop_capabilities_public (
    shop_id, bw_printing, colour_printing, a4_paper, a3_paper, duplex_printing, updated_at
  ) VALUES (
    p_shop_id, p_bw, p_colour, p_a4, p_a3, p_duplex, now()
  )
  ON CONFLICT (shop_id) DO UPDATE
    SET bw_printing     = EXCLUDED.bw_printing,
        colour_printing = EXCLUDED.colour_printing,
        a4_paper        = EXCLUDED.a4_paper,
        a3_paper        = EXCLUDED.a3_paper,
        duplex_printing = EXCLUDED.duplex_printing,
        updated_at      = now()
  RETURNING * INTO v_cap;

  RETURN to_jsonb(v_cap);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. GRANTS FOR RPCs
-- ─────────────────────────────────────────────────────────────────────────────
GRANT EXECUTE ON
  FUNCTION autoprint_v3.find_nearby_shops(numeric, numeric, numeric, integer, integer, boolean, boolean, boolean, boolean, boolean),
  autoprint_v3.set_shop_location(uuid, uuid, numeric, numeric, text, text, text, text, text),
  autoprint_v3.set_shop_discovery_enabled(uuid, uuid, boolean, boolean),
  autoprint_v3.set_shop_capabilities(uuid, uuid, boolean, boolean, boolean, boolean, boolean)
TO autoprint_api_role, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
