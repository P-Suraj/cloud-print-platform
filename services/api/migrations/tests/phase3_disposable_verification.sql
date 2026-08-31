-- Run after the disposable bootstrap, migrations 0001–0016 and 0019.
-- Uses synthetic data only. It verifies the Phase 3 database changes without
-- contacting Supabase or any external payment/print service.

BEGIN;

INSERT INTO autoprint_v3.customers (id, identity_provider, identity_subject, phone, verified_at)
VALUES ('c0a80001-0000-0000-0000-000000000106', 'test', 'phase3-disposable-customer', '+910000000000', now());

INSERT INTO autoprint_v3.shop_pickup_policies (shop_id, pickup_workflow_enabled)
VALUES ('c0a80001-0000-0000-0000-000000000001', true);

INSERT INTO autoprint_v3.orders (
  id, shop_id, capability_hash, expires_at, status, submission_channel,
  customer_id, fulfillment_mode, payment_mode
) VALUES (
  'c0a80001-0000-0000-0000-000000000101',
  'c0a80001-0000-0000-0000-000000000001',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  now() + interval '1 day', 'printing', 'shop_code',
  'c0a80001-0000-0000-0000-000000000106', 'remote', 'pay_at_pickup'
);

INSERT INTO autoprint_v3.source_documents (
  id, order_id, object_path, original_file_name, declared_media_type,
  declared_byte_size, verified_byte_size
) VALUES (
  'c0a80001-0000-0000-0000-000000000102',
  'c0a80001-0000-0000-0000-000000000101', 'phase3/disposable/source.pdf',
  'source.pdf', 'application/pdf', 100, 100
);

INSERT INTO autoprint_v3.print_artifacts (
  id, source_document_id, object_path, sha256, renderer_name, renderer_version,
  logical_page_count, byte_size
) VALUES (
  'c0a80001-0000-0000-0000-000000000103',
  'c0a80001-0000-0000-0000-000000000102', 'phase3/disposable/artifact.pdf',
  repeat('b', 64), 'test', '1', 1, 100
);

INSERT INTO autoprint_v3.price_quotes (
  id, order_id, artifact_id, artifact_sha256, options_json, options_hash,
  rate_card_id, rate_card_version, breakdown_json, total_amount, expires_at
) VALUES (
  'c0a80001-0000-0000-0000-000000000104',
  'c0a80001-0000-0000-0000-000000000101',
  'c0a80001-0000-0000-0000-000000000103', repeat('b', 64), '{}'::jsonb,
  repeat('c', 64),
  (SELECT id FROM autoprint_v3.rate_cards WHERE shop_id = 'c0a80001-0000-0000-0000-000000000001' LIMIT 1),
  1, '{}'::jsonb, 2.00, now() + interval '1 hour'
);

INSERT INTO autoprint_v3.print_jobs (
  id, order_id, shop_id, artifact_id, quote_id, status, print_eligibility
) VALUES (
  'c0a80001-0000-0000-0000-000000000105',
  'c0a80001-0000-0000-0000-000000000101',
  'c0a80001-0000-0000-0000-000000000001',
  'c0a80001-0000-0000-0000-000000000103',
  'c0a80001-0000-0000-0000-000000000104', 'printing', 'shop_risk_accepted'
);

UPDATE autoprint_v3.print_jobs
SET status = 'completed', completed_at = now(),
    completion_source = 'operator_confirmed', completion_evidence_json = '{"test":true}'::jsonb
WHERE id = 'c0a80001-0000-0000-0000-000000000105';

DO $$
DECLARE
  v_pickup_id uuid;
  v_ready_count integer;
  v_outbox_count integer;
  v_allowed_count integer;
  v_denied_count integer;
BEGIN
  SELECT id INTO v_pickup_id FROM autoprint_v3.pickups
  WHERE job_id = 'c0a80001-0000-0000-0000-000000000105';
  IF v_pickup_id IS NULL THEN
    RAISE EXCEPTION 'Phase 3 trigger did not create a pickup';
  END IF;

  PERFORM autoprint_v3.create_or_ready_pickup_after_confirmed_print(
    'c0a80001-0000-0000-0000-000000000105'
  );

  SELECT count(*) INTO v_ready_count FROM autoprint_v3.pickups
  WHERE job_id = 'c0a80001-0000-0000-0000-000000000105'
    AND status = 'ready_for_pickup';
  SELECT count(*) INTO v_outbox_count FROM autoprint_v3.notification_outbox
  WHERE pickup_id = v_pickup_id AND event_type = 'pickup.ready';
  IF v_ready_count <> 1 OR v_outbox_count <> 1 THEN
    RAISE EXCEPTION 'Pickup readiness idempotency failed: pickup %, outbox %', v_ready_count, v_outbox_count;
  END IF;

  SELECT count(*) FILTER (WHERE (result->>'allowed')::boolean),
         count(*) FILTER (WHERE NOT (result->>'allowed')::boolean)
  INTO v_allowed_count, v_denied_count
  FROM (
    SELECT autoprint_v3.consume_pickup_attempt(
      v_pickup_id, 'c0a80001-0000-0000-0000-000000000001', repeat('d', 64)
    ) AS result
    FROM generate_series(1, 6)
  ) attempts;
  IF v_allowed_count <> 5 OR v_denied_count <> 1 THEN
    RAISE EXCEPTION 'Pickup attempt limiting failed: allowed %, denied %', v_allowed_count, v_denied_count;
  END IF;
END $$;

COMMIT;

SELECT 'PHASE3_DISPOSABLE_VERIFICATION_PASSED' AS result;
