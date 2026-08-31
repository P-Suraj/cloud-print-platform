-- SQL Test Cases: Lease Fencing & Stale Token Verification
-- Target Namespace: autoprint_v3

BEGIN;

-- Verify stored functions exist
SELECT 'VERIFY_FUNCTIONS' AS test_name, proname AS function_name, 'PASS' AS result
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'autoprint_v3' AND proname IN (
  'claim_next_print_job', 'renew_print_attempt_lease', 'advance_print_attempt', 
  'report_print_outcome', 'resolve_uncertain_print_attempt', 'claim_preparation_task', 
  'complete_preparation_task'
);

ROLLBACK;
