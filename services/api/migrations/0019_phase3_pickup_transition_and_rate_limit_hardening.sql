-- Phase 3 hardening: make pickup synchronization transactional with print-job
-- state changes and make rate limiting database-authoritative across API workers.
BEGIN;

CREATE OR REPLACE FUNCTION autoprint_v3.consume_pickup_attempt(
  p_pickup_id uuid,
  p_shop_id uuid,
  p_actor_bucket_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = autoprint_v3, public, extensions, pg_temp
AS $$
DECLARE
  v_now timestamptz := now();
  v_window timestamptz := date_trunc('minute', now());
  v_attempts integer := 0;
  v_locked_until timestamptz;
BEGIN
  IF p_actor_bucket_hash IS NULL OR length(p_actor_bucket_hash) <> 64 THEN
    RAISE EXCEPTION 'Invalid pickup attempt bucket' USING ERRCODE = 'P0065';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM autoprint_v3.pickups
    WHERE id = p_pickup_id AND shop_id = p_shop_id
  ) THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'invalid_pickup');
  END IF;

  -- Serializes the rolling-window check even when no attempt row exists yet.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_pickup_id::text || ':' || p_actor_bucket_hash, 0));

  SELECT COALESCE(sum(attempt_count), 0), max(locked_until)
  INTO v_attempts, v_locked_until
  FROM autoprint_v3.pickup_attempts
  WHERE pickup_id = p_pickup_id
    AND actor_bucket_hash = p_actor_bucket_hash
    AND window_start > v_now - interval '15 minutes';

  IF (v_locked_until IS NOT NULL AND v_locked_until > v_now) OR v_attempts >= 5 THEN
    INSERT INTO autoprint_v3.pickup_attempts (
      pickup_id, shop_id, actor_bucket_hash, window_start,
      attempt_count, locked_until, last_outcome
    ) VALUES (
      p_pickup_id, p_shop_id, p_actor_bucket_hash, v_window,
      0, v_now + interval '15 minutes', 'rate_limited'
    ) ON CONFLICT (pickup_id, actor_bucket_hash, window_start) DO UPDATE
      SET locked_until = greatest(
            COALESCE(autoprint_v3.pickup_attempts.locked_until, '-infinity'::timestamptz),
            EXCLUDED.locked_until
          ),
          last_outcome = 'rate_limited',
          updated_at = now();
    RETURN jsonb_build_object('allowed', false, 'reason', 'too_many_attempts');
  END IF;

  INSERT INTO autoprint_v3.pickup_attempts (
    pickup_id, shop_id, actor_bucket_hash, window_start, attempt_count, last_outcome
  ) VALUES (
    p_pickup_id, p_shop_id, p_actor_bucket_hash, v_window, 1, 'failure'
  ) ON CONFLICT (pickup_id, actor_bucket_hash, window_start) DO UPDATE
    SET attempt_count = autoprint_v3.pickup_attempts.attempt_count + 1,
        last_outcome = 'failure',
        updated_at = now();

  RETURN jsonb_build_object('allowed', true, 'remaining', greatest(0, 4 - v_attempts));
END;
$$;

CREATE OR REPLACE FUNCTION autoprint_v3.sync_pickup_for_print_job_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = autoprint_v3, public, extensions, pg_temp
AS $$
BEGIN
  IF NEW.status = 'completed' THEN
    PERFORM autoprint_v3.create_or_ready_pickup_after_confirmed_print(NEW.id);
  ELSIF NEW.status IN ('failed', 'rejected', 'cancelled') THEN
    PERFORM autoprint_v3.void_pickup_for_terminal_order(
      NEW.id,
      'job_terminal_state:' || NEW.status::text
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_pickup_for_print_job_status ON autoprint_v3.print_jobs;
CREATE TRIGGER trg_sync_pickup_for_print_job_status
AFTER UPDATE OF status ON autoprint_v3.print_jobs
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION autoprint_v3.sync_pickup_for_print_job_status();

GRANT EXECUTE ON
  FUNCTION autoprint_v3.consume_pickup_attempt(uuid, uuid, text),
  autoprint_v3.sync_pickup_for_print_job_status()
TO autoprint_api_role, service_role;

COMMIT;
