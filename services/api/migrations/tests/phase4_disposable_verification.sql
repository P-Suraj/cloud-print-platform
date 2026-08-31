-- Run after the disposable bootstrap and migrations through 0020.
-- Verifies discovery filtering/order plus expiring closure and coordinate-only directions.
BEGIN;

INSERT INTO public.shops (id, shop_code, name, is_active, migration_mode)
VALUES ('c0a80001-0000-0000-0000-000000000201', 'DISC002', 'Disposable Discovery Two', true, 'v3_canary');

INSERT INTO autoprint_v3.shop_locations (
  shop_id, discovery_enabled, lat, lng, address_line, locality, pincode,
  maps_url, timezone, manual_closed_override, manual_closed_until
) VALUES
  ('c0a80001-0000-0000-0000-000000000001', true, 12.9716000, 77.5946000,
   'Canary Gate', 'Campus', '560001', 'https://maps.google.com/?q=ignored',
   'Asia/Kolkata', true, now() - interval '1 minute'),
  ('c0a80001-0000-0000-0000-000000000201', true, 12.9800000, 77.5946000,
   'Discovery Two', 'Campus', '560001', 'https://maps.google.com/?q=ignored',
   'Asia/Kolkata', false, NULL);

DO $$
DECLARE
  v_count integer;
  v_first_code text;
  v_first_url text;
  v_first_manual_closed boolean;
BEGIN
  SELECT count(*), min(shop_code) FILTER (WHERE distance_km = min_distance),
         min(maps_url) FILTER (WHERE distance_km = min_distance),
         bool_or(manual_closed_override) FILTER (WHERE shop_code = 'CANARY01')
  INTO v_count, v_first_code, v_first_url, v_first_manual_closed
  FROM (
    SELECT *, min(distance_km) OVER () AS min_distance
    FROM autoprint_v3.find_nearby_shops(12.9716000, 77.5946000, 5, 20, 0, false, false, false, false, false)
  ) nearby;
  IF v_count <> 2 OR v_first_code <> 'CANARY01' THEN
    RAISE EXCEPTION 'Discovery distance ordering failed: count %, first %', v_count, v_first_code;
  END IF;
  IF v_first_url NOT LIKE 'https://www.google.com/maps/dir/?api=1&destination=%' THEN
    RAISE EXCEPTION 'Directions URL was not coordinate-derived: %', v_first_url;
  END IF;
  IF COALESCE(v_first_manual_closed, true) THEN
    RAISE EXCEPTION 'Expired manual closure remained active';
  END IF;
END $$;

COMMIT;
SELECT 'PHASE4_DISPOSABLE_VERIFICATION_PASSED' AS result;
