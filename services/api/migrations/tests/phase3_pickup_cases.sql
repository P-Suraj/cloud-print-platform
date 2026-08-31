-- Run after migrations 0016 and 0019 in a disposable database.
-- Verifies Phase 3 contract inspection queries and concurrency rules.

SELECT proname
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='autoprint_v3' AND proname IN(
  'create_or_ready_pickup_after_confirmed_print',
  'redeem_pickup_code',
  'manual_collect_pickup',
  'expire_due_pickups',
  'mark_pickup_no_show',
  'void_pickup_for_terminal_order',
  'set_pickup_policy',
  'restore_customer_trust',
  'consume_pickup_attempt',
  'sync_pickup_for_print_job_status'
)
ORDER BY proname;

SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema='autoprint_v3' AND table_name IN(
  'shop_pickup_policies',
  'pickups',
  'pickup_attempts',
  'notification_outbox',
  'shop_customer_trust'
)
ORDER BY table_name, ordinal_position;

-- Invariant & Concurrency checks:
-- 1. Double-completion idempotency drill:
--    Repeated calls to create_or_ready_pickup_after_confirmed_print(job_id) produce exactly 1 pickup row
--    and at most 1 notification_outbox row for 'pickup.ready'.
-- 2. Code redemption concurrency drill (two shop sessions):
--    A: SELECT autoprint_v3.redeem_pickup_code(p_pickup_id, ...);
--    B: SELECT autoprint_v3.redeem_pickup_code(p_pickup_id, ...);
--    Assert: exactly one returns result='collected', the other returns result='already_collected'.
-- 3. Expiry worker race drill (two workers running expire_due_pickups concurrently):
--    Both run FOR UPDATE SKIP LOCKED. Exactly 1 transition per due pickup, 1 outbox event.
-- 4. Premature no-show rejection:
--    Attempting mark_pickup_no_show before hold_until expires fails closed with error code P0058 / P0060.
-- 5. Manual collect reason validation:
--    Reason length < 10 fails closed with error code P0051.
-- 6. Job-state trigger drill:
--    Update a remote test print_job to completed through its authoritative
--    outcome path. Assert exactly one ready pickup and one pickup.ready event.
--    In a separate test, transition a pre-ready test job to failed/rejected/
--    cancelled and assert any awaiting_print pickup becomes voided in the same
--    transaction.
-- 7. Database rate-limit race drill (two database sessions):
--    Call consume_pickup_attempt with the same pickup and actor bucket from
--    both sessions until six total calls occur. Assert exactly five responses
--    have allowed=true and every later response has allowed=false. Restarting
--    either API process must not reset the persisted window.

SELECT tgname, tgenabled
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'autoprint_v3'
  AND c.relname = 'print_jobs'
  AND tgname = 'trg_sync_pickup_for_print_job_status';
