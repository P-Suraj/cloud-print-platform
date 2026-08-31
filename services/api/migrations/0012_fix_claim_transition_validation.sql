-- Migration 0012: Restore agent job claiming and validate attempt transitions
-- The transition guard was mistakenly installed in claim_next_print_job even
-- though that function has no expected/new status parameters.

BEGIN;

CREATE OR REPLACE FUNCTION autoprint_v3.claim_next_print_job(
  p_device_id uuid,
  p_lease_seconds integer DEFAULT 300
)
RETURNS TABLE (
  job_id uuid,
  attempt_id uuid,
  fencing_token text,
  artifact_sha256 text,
  artifact_object_path text,
  options_json jsonb,
  lease_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = autoprint_v3, public, extensions, pg_temp
AS $$
DECLARE
  v_device_shop_id uuid;
  v_device_status autoprint_v3.device_status;
  v_job_record autoprint_v3.print_jobs%ROWTYPE;
  v_artifact_record autoprint_v3.print_artifacts%ROWTYPE;
  v_quote_record autoprint_v3.price_quotes%ROWTYPE;
  v_fencing_token text;
  v_attempt_id uuid;
  v_lease_expiry timestamptz;
BEGIN
  SELECT shop_id, status INTO v_device_shop_id, v_device_status
  FROM autoprint_v3.devices
  WHERE id = p_device_id;

  IF v_device_shop_id IS NULL OR v_device_status != 'active' THEN
    RAISE EXCEPTION 'Device % is invalid or revoked', p_device_id USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_job_record
  FROM autoprint_v3.print_jobs
  WHERE shop_id = v_device_shop_id
    AND status = 'waiting_for_shop'
    AND approved_at IS NOT NULL
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_job_record.id IS NULL THEN
    RETURN;
  END IF;

  v_fencing_token := encode(extensions.gen_random_bytes(16), 'hex');
  v_lease_expiry := now() + (p_lease_seconds || ' seconds')::interval;

  SELECT * INTO v_artifact_record FROM autoprint_v3.print_artifacts WHERE id = v_job_record.artifact_id;
  SELECT * INTO v_quote_record FROM autoprint_v3.price_quotes WHERE id = v_job_record.quote_id;

  INSERT INTO autoprint_v3.print_attempts (
    job_id, device_id, fencing_token, status, lease_expires_at, last_renewed_at, artifact_sha256, options_hash
  ) VALUES (
    v_job_record.id, p_device_id, v_fencing_token, 'leased', v_lease_expiry, now(), v_artifact_record.sha256, v_quote_record.options_hash
  ) RETURNING id INTO v_attempt_id;

  UPDATE autoprint_v3.print_jobs
  SET status = 'printing', current_attempt_id = v_attempt_id, updated_at = now()
  WHERE id = v_job_record.id;

  INSERT INTO autoprint_v3.job_transitions (job_id, attempt_id, from_status, to_status, actor_type, actor_id, reason_code)
  VALUES (v_job_record.id, v_attempt_id, 'waiting_for_shop', 'printing', 'device', p_device_id, 'CLAIM_SUCCESS');

  INSERT INTO autoprint_v3.audit_events (shop_id, actor_type, actor_id, event_type, target_type, target_id)
  VALUES (v_device_shop_id, 'device', p_device_id, 'JOB_CLAIMED', 'print_jobs', v_job_record.id);

  RETURN QUERY SELECT
    v_job_record.id,
    v_attempt_id,
    v_fencing_token,
    v_artifact_record.sha256,
    v_artifact_record.object_path,
    v_quote_record.options_json,
    v_lease_expiry;
END;
$$;

CREATE OR REPLACE FUNCTION autoprint_v3.advance_print_attempt(
  p_job_id uuid,
  p_attempt_id uuid,
  p_fencing_token text,
  p_device_id uuid,
  p_expected_status autoprint_v3.attempt_status,
  p_new_status autoprint_v3.attempt_status,
  p_evidence_json jsonb DEFAULT '{}'::jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = autoprint_v3, public, extensions, pg_temp
AS $$
DECLARE
  v_updated integer;
BEGIN
  IF NOT (
    (p_expected_status = 'leased' AND p_new_status = 'artifact_verified') OR
    (p_expected_status = 'artifact_verified' AND p_new_status = 'submission_intent_recorded') OR
    (p_expected_status = 'submission_intent_recorded' AND p_new_status = 'submission_process_started') OR
    (p_expected_status = 'submission_process_started' AND p_new_status = 'submission_accepted') OR
    (p_expected_status = 'submission_accepted' AND p_new_status = 'spooler_observed') OR
    (p_expected_status = 'spooler_observed' AND p_new_status IN ('confirmed_printed', 'outcome_uncertain')) OR
    (p_expected_status = 'submission_accepted' AND p_new_status = 'outcome_uncertain')
  ) THEN
    RAISE EXCEPTION 'Invalid attempt transition: % -> %', p_expected_status, p_new_status
      USING ERRCODE = 'P0008';
  END IF;

  UPDATE autoprint_v3.print_attempts
  SET status = p_new_status, updated_at = now()
  WHERE id = p_attempt_id
    AND job_id = p_job_id
    AND fencing_token = p_fencing_token
    AND device_id = p_device_id
    AND status = p_expected_status
    AND lease_expires_at > now();

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

COMMIT;
