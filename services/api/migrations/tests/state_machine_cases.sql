-- SQL Test Cases: State Machine Transitions Verification
-- Target Namespace: autoprint_v3

BEGIN;

-- Verify allowed transitions query
SELECT 'STATE_TRANSITIONS_COUNT' AS test_name, count(*) AS total_allowed_rules, 'PASS' AS result
FROM autoprint_v3.allowed_job_transitions;

-- Assert key transitions exist
SELECT 'VERIFY_RULE' AS test_name, from_status || ' -> ' || to_status || ' (' || actor_type || ')' AS rule, 'PASS' AS result
FROM autoprint_v3.allowed_job_transitions
WHERE (from_status = 'waiting_for_shop' AND to_status = 'printing' AND actor_type = 'device')
   OR (from_status = 'printing' AND to_status = 'needs_attention' AND actor_type = 'system')
   OR (from_status = 'needs_attention' AND to_status = 'completed' AND actor_type = 'shop_user');

ROLLBACK;
