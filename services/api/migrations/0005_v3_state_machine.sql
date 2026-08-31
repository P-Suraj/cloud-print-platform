-- Migration 0005: v3 State Machine Allowed Transitions Setup
-- Target Namespace: autoprint_v3

BEGIN;

INSERT INTO autoprint_v3.allowed_job_transitions (from_status, to_status, actor_type)
VALUES
  -- Device claims approved job
  ('waiting_for_shop', 'printing', 'device'),
  -- Shop user rejects queued job
  ('waiting_for_shop', 'rejected', 'shop_user'),
  -- Customer cancels pre-claim job or shop user cancels
  ('waiting_for_shop', 'cancelled', 'anonymous_customer'),
  ('waiting_for_shop', 'cancelled', 'shop_user'),
  -- Printing completes cleanly (device telemetry or spooler clearance)
  ('printing', 'completed', 'device'),
  ('printing', 'completed', 'shop_user'),
  -- Printing fails definitively
  ('printing', 'failed', 'device'),
  ('printing', 'failed', 'shop_user'),
  -- Printing encounters ambiguous spooler or lease expiry
  ('printing', 'needs_attention', 'device'),
  ('printing', 'needs_attention', 'system'),
  ('printing', 'needs_attention', 'shop_user'),
  -- Operator resolves ambiguous needs_attention job
  ('needs_attention', 'completed', 'shop_user'),
  ('needs_attention', 'failed', 'shop_user')
ON CONFLICT DO NOTHING;

COMMIT;
