-- Shopkeeper print-setting overrides before approval.
-- The accepted customer quote remains immutable.  This records a separately
-- audited operational instruction that the fenced agent receives on claim.
BEGIN;

ALTER TABLE autoprint_v3.print_jobs
  ADD COLUMN IF NOT EXISTS shop_options_override_json jsonb,
  ADD COLUMN IF NOT EXISTS shop_options_override_hash text,
  ADD COLUMN IF NOT EXISTS shop_options_overridden_at timestamptz,
  ADD COLUMN IF NOT EXISTS shop_options_overridden_by_user_id uuid
    REFERENCES autoprint_v3.users(id);

CREATE OR REPLACE FUNCTION autoprint_v3.set_shop_print_options(
  p_job_id uuid,
  p_user_id uuid,
  p_options jsonb,
  p_options_hash text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = autoprint_v3, public, pg_temp
AS $$
DECLARE
  v_job autoprint_v3.print_jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_job FROM autoprint_v3.print_jobs WHERE id = p_job_id FOR UPDATE;
  IF v_job.id IS NULL OR v_job.status != 'waiting_for_shop' OR v_job.approved_at IS NOT NULL THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM autoprint_v3.shop_memberships
    WHERE user_id = p_user_id AND shop_id = v_job.shop_id AND active
      AND role IN ('owner', 'staff')
  ) THEN
    RAISE EXCEPTION 'User cannot edit this shop job' USING ERRCODE = 'P0022';
  END IF;

  UPDATE autoprint_v3.print_jobs
  SET shop_options_override_json = p_options,
      shop_options_override_hash = p_options_hash,
      shop_options_overridden_at = now(),
      shop_options_overridden_by_user_id = p_user_id,
      updated_at = now()
  WHERE id = p_job_id;

  INSERT INTO autoprint_v3.audit_events
    (shop_id, actor_type, actor_id, event_type, target_type, target_id, metadata_json)
  VALUES
    (v_job.shop_id, 'shop_user', p_user_id, 'JOB_PRINT_OPTIONS_OVERRIDDEN',
     'print_jobs', p_job_id, jsonb_build_object('options_hash', p_options_hash));
  RETURN true;
END;
$$;

-- Keep the claim response stable for the current Windows agent.  Its options
-- now resolve to the shop override when present, while its attempt journal
-- records the corresponding hash.
CREATE OR REPLACE FUNCTION autoprint_v3.claim_next_print_job(
  p_device_id uuid,
  p_lease_seconds integer DEFAULT 300
)
RETURNS TABLE (
  job_id uuid, attempt_id uuid, fencing_token text, artifact_sha256 text,
  artifact_object_path text, options_json jsonb, lease_expires_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = autoprint_v3, public, pg_temp
AS $$
DECLARE
  v_device_shop_id uuid; v_device_status autoprint_v3.device_status;
  v_job_record autoprint_v3.print_jobs%ROWTYPE;
  v_artifact_record autoprint_v3.print_artifacts%ROWTYPE;
  v_quote_record autoprint_v3.price_quotes%ROWTYPE;
  v_fencing_token text; v_attempt_id uuid; v_lease_expiry timestamptz;
  v_options jsonb; v_options_hash text;
BEGIN
  SELECT shop_id, status INTO v_device_shop_id, v_device_status
  FROM autoprint_v3.devices WHERE id = p_device_id;
  IF v_device_shop_id IS NULL OR v_device_status != 'active' THEN
    RAISE EXCEPTION 'Device % is invalid or revoked', p_device_id USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_job_record FROM autoprint_v3.print_jobs
  WHERE shop_id = v_device_shop_id AND status = 'waiting_for_shop' AND approved_at IS NOT NULL
  ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF v_job_record.id IS NULL THEN RETURN; END IF;
  SELECT * INTO v_artifact_record FROM autoprint_v3.print_artifacts WHERE id = v_job_record.artifact_id;
  SELECT * INTO v_quote_record FROM autoprint_v3.price_quotes WHERE id = v_job_record.quote_id;
  v_options := COALESCE(v_job_record.shop_options_override_json, v_quote_record.options_json);
  v_options_hash := COALESCE(v_job_record.shop_options_override_hash, v_quote_record.options_hash);
  v_fencing_token := encode(extensions.gen_random_bytes(16), 'hex');
  v_lease_expiry := now() + (p_lease_seconds || ' seconds')::interval;
  INSERT INTO autoprint_v3.print_attempts
    (job_id, device_id, fencing_token, status, lease_expires_at, last_renewed_at, artifact_sha256, options_hash)
  VALUES
    (v_job_record.id, p_device_id, v_fencing_token, 'leased', v_lease_expiry, now(), v_artifact_record.sha256, v_options_hash)
  RETURNING id INTO v_attempt_id;
  UPDATE autoprint_v3.print_jobs SET status = 'printing', current_attempt_id = v_attempt_id, updated_at = now()
  WHERE id = v_job_record.id;
  INSERT INTO autoprint_v3.job_transitions (job_id, attempt_id, from_status, to_status, actor_type, actor_id, reason_code)
  VALUES (v_job_record.id, v_attempt_id, 'waiting_for_shop', 'printing', 'device', p_device_id, 'CLAIM_SUCCESS');
  INSERT INTO autoprint_v3.audit_events (shop_id, actor_type, actor_id, event_type, target_type, target_id)
  VALUES (v_device_shop_id, 'device', p_device_id, 'JOB_CLAIMED', 'print_jobs', v_job_record.id);
  RETURN QUERY SELECT v_job_record.id, v_attempt_id, v_fencing_token, v_artifact_record.sha256,
    v_artifact_record.object_path, v_options, v_lease_expiry;
END;
$$;

GRANT EXECUTE ON FUNCTION autoprint_v3.set_shop_print_options(uuid, uuid, jsonb, text)
TO autoprint_api_role;

COMMIT;
