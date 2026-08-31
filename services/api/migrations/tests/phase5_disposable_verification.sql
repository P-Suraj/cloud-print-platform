-- Run after the disposable bootstrap and migrations through 0018.
-- Verifies Phase 5's safety boundary, lane isolation/sharing, backlog expiry,
-- selected-page workload and prediction-versus-actual evidence.

BEGIN;

INSERT INTO autoprint_v3.devices (id, shop_id, display_name, credential_hash, status, last_seen_at)
VALUES ('c0a80001-0000-0000-0000-000000000501', 'c0a80001-0000-0000-0000-000000000001',
        'Phase 5 disposable printer', repeat('e', 64), 'active', now());

INSERT INTO autoprint_v3.shop_printer_lanes
  (shop_id, lane_type, device_id, physical_device_key, ppm_simplex, ppm_duplex, job_setup_overhead_sec)
VALUES
  ('c0a80001-0000-0000-0000-000000000001', 'bw', 'c0a80001-0000-0000-0000-000000000501', 'bw-only', 20, 10, 10),
  ('c0a80001-0000-0000-0000-000000000001', 'colour', 'c0a80001-0000-0000-0000-000000000501', 'colour-only', 10, 5, 10);

INSERT INTO autoprint_v3.orders
  (id, shop_id, capability_hash, expires_at, status, submission_channel)
VALUES
  ('c0a80001-0000-0000-0000-000000000511', 'c0a80001-0000-0000-0000-000000000001',
   repeat('a', 64), now() + interval '1 day', 'waiting_for_shop', 'shop_code');

INSERT INTO autoprint_v3.source_documents
  (id, order_id, object_path, original_file_name, declared_media_type, declared_byte_size, verified_byte_size)
VALUES
  ('c0a80001-0000-0000-0000-000000000512', 'c0a80001-0000-0000-0000-000000000511',
   'phase5/disposable/source.pdf', 'source.pdf', 'application/pdf', 100, 100);

INSERT INTO autoprint_v3.print_artifacts
  (id, source_document_id, object_path, sha256, renderer_name, renderer_version, logical_page_count, byte_size)
VALUES
  ('c0a80001-0000-0000-0000-000000000513', 'c0a80001-0000-0000-0000-000000000512',
   'phase5/disposable/artifact.pdf', repeat('b', 64), 'test', '1', 10, 100);

INSERT INTO autoprint_v3.price_quotes
  (id, order_id, artifact_id, artifact_sha256, options_json, options_hash, rate_card_id, rate_card_version, breakdown_json, total_amount, expires_at)
VALUES
  ('c0a80001-0000-0000-0000-000000000514', 'c0a80001-0000-0000-0000-000000000511',
   'c0a80001-0000-0000-0000-000000000513', repeat('b', 64),
   '{"copies":2,"colour":false,"duplex":false}'::jsonb, repeat('c', 64),
   (SELECT id FROM autoprint_v3.rate_cards WHERE shop_id = 'c0a80001-0000-0000-0000-000000000001' LIMIT 1),
   1, '{"selected_page_count":3,"copies":2}'::jsonb, 2.00, now() + interval '1 hour');

INSERT INTO autoprint_v3.print_jobs
  (id, order_id, shop_id, artifact_id, quote_id, status, approved_at, print_eligibility)
VALUES
  ('c0a80001-0000-0000-0000-000000000515', 'c0a80001-0000-0000-0000-000000000511',
   'c0a80001-0000-0000-0000-000000000001', 'c0a80001-0000-0000-0000-000000000513',
   'c0a80001-0000-0000-0000-000000000514', 'waiting_for_shop', now(), 'counter');

DO $$
DECLARE
  v_bw jsonb;
  v_colour jsonb;
  v_shared_colour jsonb;
  v_backlog jsonb;
  v_stale jsonb;
  v_snapshot_count integer;
BEGIN
  v_bw := autoprint_v3.calculate_queue_estimate('c0a80001-0000-0000-0000-000000000001', 'bw', 3, 2, false);
  v_colour := autoprint_v3.calculate_queue_estimate('c0a80001-0000-0000-0000-000000000001', 'colour', 3, 1, false);
  IF (v_bw->>'confidence') <> 'high' OR (v_bw->>'queue_depth')::integer <> 1 THEN
    RAISE EXCEPTION 'Fresh B&W workload estimate was incorrect: %', v_bw;
  END IF;
  IF (v_colour->>'queue_depth')::integer <> 0 THEN
    RAISE EXCEPTION 'Independent colour lane incorrectly counted B&W work: %', v_colour;
  END IF;

  UPDATE autoprint_v3.shop_printer_lanes
  SET physical_device_key = 'bw-only'
  WHERE shop_id = 'c0a80001-0000-0000-0000-000000000001' AND lane_type = 'colour';
  v_shared_colour := autoprint_v3.calculate_queue_estimate('c0a80001-0000-0000-0000-000000000001', 'colour', 3, 1, false);
  IF (v_shared_colour->>'queue_depth')::integer <> 1 THEN
    RAISE EXCEPTION 'Shared physical lane did not count B&W work: %', v_shared_colour;
  END IF;

  INSERT INTO autoprint_v3.shop_walkin_backlogs (shop_id, lane_type, backlog_minutes, expires_at)
  VALUES ('c0a80001-0000-0000-0000-000000000001', 'bw', 5, now() + interval '30 minutes');
  v_backlog := autoprint_v3.calculate_queue_estimate('c0a80001-0000-0000-0000-000000000001', 'bw', 0, 1, false);
  IF (v_backlog->>'estimated_min')::integer < 5 THEN
    RAISE EXCEPTION 'Active walk-in backlog was not included: %', v_backlog;
  END IF;

  SELECT count(*) INTO v_snapshot_count FROM autoprint_v3.queue_estimate_calibration_logs
  WHERE job_id = 'c0a80001-0000-0000-0000-000000000515';
  IF v_snapshot_count <> 1 THEN
    RAISE EXCEPTION 'Prediction snapshot was not recorded';
  END IF;

  UPDATE autoprint_v3.devices SET last_seen_at = now() - interval '2 minutes'
  WHERE id = 'c0a80001-0000-0000-0000-000000000501';
  v_stale := autoprint_v3.calculate_queue_estimate('c0a80001-0000-0000-0000-000000000001', 'bw', 1, 1, false);
  IF (v_stale->>'confidence') <> 'unavailable' THEN
    RAISE EXCEPTION 'Stale agent was presented as available: %', v_stale;
  END IF;
END $$;

UPDATE autoprint_v3.print_jobs SET status = 'printing'
WHERE id = 'c0a80001-0000-0000-0000-000000000515';
UPDATE autoprint_v3.print_jobs SET status = 'completed', completed_at = now(), completion_source = 'operator_confirmed'
WHERE id = 'c0a80001-0000-0000-0000-000000000515';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM autoprint_v3.queue_estimate_calibration_logs
    WHERE job_id = 'c0a80001-0000-0000-0000-000000000515'
      AND actual_ready_seconds IS NOT NULL AND completed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Actual completion was not captured for calibration';
  END IF;
END $$;

COMMIT;
SELECT 'PHASE5_DISPOSABLE_VERIFICATION_PASSED' AS result;
