-- Run after migrations 0014 and 0015 in a disposable database.
-- These are contract inspection queries; the cancel/claim concurrency drill
-- uses two database sessions against the same generated test job.

SELECT proname
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='autoprint_v3' AND proname IN(
  'create_customer_order_v3','set_shop_remote_policy','accept_unpaid_preprint_risk',
  'check_in_remote_order','cancel_print_job_if_unclaimed','claim_next_print_job'
)
ORDER BY proname;

SELECT table_name,column_name
FROM information_schema.columns
WHERE table_schema='autoprint_v3' AND(
  (table_name='orders' AND column_name IN('customer_id','fulfillment_mode','payment_mode','remote_policy_snapshot','customer_checked_in_at')) OR
  (table_name='print_jobs' AND column_name IN('print_eligibility','shop_risk_accepted_at','shop_risk_accepted_by_user_id'))
)
ORDER BY table_name,column_name;

-- Concurrency drill (two sessions):
-- A: BEGIN; SELECT autoprint_v3.cancel_print_job_if_unclaimed(...); COMMIT;
-- B: simultaneously SELECT * FROM autoprint_v3.claim_next_print_job(...);
-- Assert exactly one result wins, the job has either status=cancelled with no
-- attempt or status=printing with one current_attempt_id, never both.
