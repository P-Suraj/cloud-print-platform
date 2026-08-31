-- AutoPrint v3 Schema Verification Script
-- Target Namespace: autoprint_v3

SELECT 'CHECK_ENUMS' AS check_type, typname AS item_name, 'PASS' AS result
FROM pg_type 
JOIN pg_namespace n ON n.oid = pg_type.typnamespace
WHERE n.nspname = 'autoprint_v3' AND typname IN (
  'migration_mode', 'membership_role', 'device_status', 'order_status', 
  'preparation_status', 'cleanup_status', 'job_status', 'attempt_status', 
  'actor_type', 'completion_source'
)
UNION ALL
SELECT 'CHECK_TABLES' AS check_type, table_name AS item_name, 'PASS' AS result
FROM information_schema.tables
WHERE table_schema = 'autoprint_v3' AND table_name IN (
  'users', 'shop_memberships', 'user_sessions', 'devices', 'device_enrollment_codes',
  'orders', 'source_documents', 'preparation_tasks', 'print_artifacts', 'rate_cards',
  'price_quotes', 'print_jobs', 'print_attempts', 'job_transitions', 'allowed_job_transitions',
  'audit_events', 'idempotency_keys', 'customers', 'customer_sessions',
  'shop_remote_policies', 'cancellations',
  'shop_pickup_policies', 'pickups', 'pickup_attempts', 'notification_outbox', 'shop_customer_trust',
  'shop_locations', 'shop_hours', 'shop_hour_exceptions', 'shop_capabilities_public',
  'shop_printer_lanes', 'shop_walkin_backlogs', 'queue_estimate_calibration_logs',
  'price_quote_items'
)
UNION ALL
SELECT 'CHECK_RLS' AS check_type, relname AS item_name, CASE WHEN relrowsecurity THEN 'PASS' ELSE 'FAIL' END AS result
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'autoprint_v3' AND c.relkind = 'r';

DO $$
DECLARE
  missing_items text;
BEGIN
  SELECT string_agg(required_name, ', ' ORDER BY required_name) INTO missing_items
  FROM unnest(ARRAY[
    'users','shop_memberships','user_sessions','devices','device_enrollment_codes',
    'orders','source_documents','preparation_tasks','print_artifacts','rate_cards',
    'price_quotes','print_jobs','print_attempts','job_transitions','allowed_job_transitions',
    'audit_events','idempotency_keys','customers','customer_sessions',
    'shop_remote_policies','cancellations',
    'shop_pickup_policies','pickups','pickup_attempts','notification_outbox','shop_customer_trust',
    'shop_locations','shop_hours','shop_hour_exceptions','shop_capabilities_public',
    'shop_printer_lanes','shop_walkin_backlogs','queue_estimate_calibration_logs','price_quote_items'
  ]) AS required(required_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'autoprint_v3' AND table_name = required_name
  );
  IF missing_items IS NOT NULL THEN
    RAISE EXCEPTION 'Missing v3 tables: %', missing_items;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('user_sessions','shop_id'), ('user_sessions','role'), ('user_sessions','last_active_at'),
      ('source_documents','declared_byte_size'), ('source_documents','verified_byte_size'),
      ('orders','submission_channel'),
      ('orders','customer_id'), ('orders','fulfillment_mode'), ('orders','payment_mode'),
      ('orders','remote_policy_snapshot'), ('orders','customer_checked_in_at'),
      ('print_jobs','print_eligibility'), ('print_jobs','shop_risk_accepted_at'),
      ('print_jobs','quote_item_id'), ('price_quote_items','artifact_sha256'),
      ('price_quote_items','options_hash'),
      ('print_jobs','current_attempt_id'), ('print_attempts','fencing_token'),
      ('pickups','code_hash'), ('pickups','ready_at'), ('pickups','hold_until'),
      ('shop_pickup_policies','pickup_workflow_enabled'),
       ('shop_locations','discovery_enabled'), ('shop_locations','lat'), ('shop_locations','lng'), ('shop_locations','manual_closed_until'),
      ('shop_hours','day_of_week'), ('shop_hour_exceptions','exception_date'),
      ('shop_capabilities_public','shop_id'),
       ('shop_printer_lanes','lane_type'), ('shop_printer_lanes','physical_device_key'),
       ('shop_printer_lanes','enabled'), ('shop_walkin_backlogs','lane_type'),
       ('shop_walkin_backlogs','expires_at'), ('queue_estimate_calibration_logs','estimated_seconds_min'),
       ('queue_estimate_calibration_logs','actual_ready_seconds')
    ) AS required(table_name, column_name)
    WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'autoprint_v3'
        AND c.table_name = required.table_name
        AND c.column_name = required.column_name
    )
  ) THEN
    RAISE EXCEPTION 'One or more required v3 contract columns are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'shops' AND column_name = 'migration_mode'
  ) THEN
    RAISE EXCEPTION 'public.shops.migration_mode is missing';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'autoprint_v3' AND c.relkind = 'r' AND NOT c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'RLS is disabled on one or more v3 tables';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autoprint_api_role')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autoprint_worker_role') THEN
    RAISE EXCEPTION 'Required application roles are missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'print-jobs' AND public = false) THEN
    RAISE EXCEPTION 'Private print-jobs storage bucket is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'authenticator'
      AND EXISTS (
        SELECT 1 FROM unnest(rolconfig) setting
        WHERE setting LIKE 'pgrst.db_schemas=%autoprint_v3%'
      )
  ) THEN
    RAISE EXCEPTION 'autoprint_v3 is not configured as an exposed PostgREST schema';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(ARRAY[
      'create_customer_order_v3','set_shop_remote_policy','accept_unpaid_preprint_risk',
      'check_in_remote_order','cancel_print_job_if_unclaimed',
      'create_or_ready_pickup_after_confirmed_print','redeem_pickup_code',
      'manual_collect_pickup','expire_due_pickups','mark_pickup_no_show',
      'void_pickup_for_terminal_order','set_pickup_policy','restore_customer_trust',
      'find_nearby_shops','set_shop_location','set_shop_discovery_enabled',
      'set_shop_capabilities','calculate_queue_estimate','snapshot_queue_estimate_for_job',
      'capture_queue_estimate_actual',
      'consume_pickup_attempt','sync_pickup_for_print_job_status'
      ,'create_batch_price_quote','accept_batch_quote','claim_preparation_task_for_document'
    ]) AS required(required_function)
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='autoprint_v3' AND p.proname=required_function
    )
  ) THEN
    RAISE EXCEPTION 'One or more Phase 1/2/3 transactional functions are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger trigger_row
    JOIN pg_class relation_row ON relation_row.oid = trigger_row.tgrelid
    JOIN pg_namespace namespace_row ON namespace_row.oid = relation_row.relnamespace
    WHERE namespace_row.nspname = 'autoprint_v3'
      AND relation_row.relname = 'print_jobs'
      AND trigger_row.tgname = 'trg_sync_pickup_for_print_job_status'
      AND NOT trigger_row.tgisinternal
  ) THEN
    RAISE EXCEPTION 'Phase 3 pickup status synchronization trigger is missing';
  END IF;
END $$;

SELECT 'AUTOPRINT_V3_SCHEMA_VERIFIED' AS verification_result;
