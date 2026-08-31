-- Migration 0006: v3 State Machine Transaction Functions
-- Target Namespace: autoprint_v3

BEGIN;

-- 1. claim_next_print_job
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
SET search_path = autoprint_v3, public, pg_temp
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
  -- Verify device existence & status
  SELECT shop_id, status INTO v_device_shop_id, v_device_status
  FROM autoprint_v3.devices
  WHERE id = p_device_id;

  IF v_device_shop_id IS NULL OR v_device_status != 'active' THEN
    RAISE EXCEPTION 'Device % is invalid or revoked', p_device_id USING ERRCODE = 'P0001';
  END IF;

  -- Lock next approved waiting_for_shop job for this device's shop
  SELECT * INTO v_job_record
  FROM autoprint_v3.print_jobs
  WHERE shop_id = v_device_shop_id 
    AND status = 'waiting_for_shop'
    AND approved_at IS NOT NULL
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_job_record.id IS NULL THEN
    RETURN; -- No job available
  END IF;

  -- Generate unique fencing token and lease expiry
  v_fencing_token := encode(extensions.gen_random_bytes(16), 'hex');
  v_lease_expiry := now() + (p_lease_seconds || ' seconds')::interval;

  -- Fetch artifact and quote
  SELECT * INTO v_artifact_record FROM autoprint_v3.print_artifacts WHERE id = v_job_record.artifact_id;
  SELECT * INTO v_quote_record FROM autoprint_v3.price_quotes WHERE id = v_job_record.quote_id;

  -- Create print attempt
  INSERT INTO autoprint_v3.print_attempts (
    job_id, device_id, fencing_token, status, lease_expires_at, last_renewed_at, artifact_sha256, options_hash
  ) VALUES (
    v_job_record.id, p_device_id, v_fencing_token, 'leased', v_lease_expiry, now(), v_artifact_record.sha256, v_quote_record.options_hash
  ) RETURNING id INTO v_attempt_id;

  -- Update job status to printing
  UPDATE autoprint_v3.print_jobs
  SET status = 'printing', current_attempt_id = v_attempt_id, updated_at = now()
  WHERE id = v_job_record.id;

  -- Record transition and audit
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

-- 2. renew_print_attempt_lease
CREATE OR REPLACE FUNCTION autoprint_v3.renew_print_attempt_lease(
  p_job_id uuid,
  p_attempt_id uuid,
  p_fencing_token text,
  p_device_id uuid,
  p_lease_seconds integer DEFAULT 300
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = autoprint_v3, public, pg_temp
AS $$
DECLARE
  v_updated integer;
  v_new_expiry timestamptz;
BEGIN
  v_new_expiry := now() + (p_lease_seconds || ' seconds')::interval;

  UPDATE autoprint_v3.print_attempts
  SET lease_expires_at = v_new_expiry, last_renewed_at = now(), updated_at = now()
  WHERE id = p_attempt_id
    AND job_id = p_job_id
    AND fencing_token = p_fencing_token
    AND device_id = p_device_id
    AND lease_expires_at > now();

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

-- 3. advance_print_attempt
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
SET search_path = autoprint_v3, public, pg_temp
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

-- 4. report_print_outcome
CREATE OR REPLACE FUNCTION autoprint_v3.report_print_outcome(
  p_job_id uuid,
  p_attempt_id uuid,
  p_fencing_token text,
  p_device_id uuid,
  p_outcome_status autoprint_v3.job_status,
  p_completion_source autoprint_v3.completion_source,
  p_evidence_json jsonb DEFAULT '{}'::jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = autoprint_v3, public, pg_temp
AS $$
DECLARE
  v_attempt_record autoprint_v3.print_attempts%ROWTYPE;
  v_job_record autoprint_v3.print_jobs%ROWTYPE;
BEGIN
  -- Attempt lookup MUST be scoped to p_job_id + lease still valid.
  -- Without job_id in the WHERE clause a device holding attempt/fence for
  -- job A could mutate job B.
  SELECT * INTO v_attempt_record
  FROM autoprint_v3.print_attempts
  WHERE id            = p_attempt_id
    AND job_id        = p_job_id          -- CRITICAL: bind attempt to this job
    AND fencing_token = p_fencing_token
    AND device_id     = p_device_id
    AND lease_expires_at > now();         -- lease must still be valid

  IF v_attempt_record.id IS NULL THEN
    RAISE EXCEPTION 'Stale or invalid fencing token, expired lease, or attempt/job mismatch'
      USING ERRCODE = 'P0002';
  END IF;

  -- Double-check attempt.job_id == p_job_id (belt + suspenders).
  IF v_attempt_record.job_id != p_job_id THEN
    RAISE EXCEPTION 'Attempt % does not belong to job %', p_attempt_id, p_job_id
      USING ERRCODE = 'P0005';
  END IF;

  -- Fetch job record for transition audit
  SELECT * INTO v_job_record
  FROM autoprint_v3.print_jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF v_job_record.id IS NULL
     OR v_job_record.status != 'printing'
     OR v_job_record.current_attempt_id IS DISTINCT FROM p_attempt_id THEN
    RAISE EXCEPTION 'Attempt is not the active printing attempt for this job'
      USING ERRCODE = 'P0009';
  END IF;

  IF p_outcome_status NOT IN ('completed', 'failed', 'needs_attention') THEN
    RAISE EXCEPTION 'Device outcome must be completed, failed, or needs_attention'
      USING ERRCODE = 'P0010';
  END IF;

  IF p_outcome_status = 'completed'
     AND p_completion_source NOT IN ('spooler_presumed', 'device_telemetry_confirmed') THEN
    RAISE EXCEPTION 'Completed device outcome requires verified completion evidence'
      USING ERRCODE = 'P0011';
  END IF;

  -- Update ONLY p_job_id — the WHERE id = p_job_id is the last line of defence
  -- against cross-job mutation.
  UPDATE autoprint_v3.print_jobs
  SET status                   = p_outcome_status,
      completion_source        = p_completion_source,
      completion_evidence_json = p_evidence_json,
      completed_at = (CASE WHEN p_outcome_status = 'completed' THEN now() ELSE NULL END),
      updated_at               = now()
  WHERE id = p_job_id;

  UPDATE autoprint_v3.print_attempts
  SET status = CASE
        WHEN p_outcome_status = 'completed' THEN 'confirmed_printed'::autoprint_v3.attempt_status
        WHEN p_outcome_status = 'failed' THEN 'confirmed_not_printed'::autoprint_v3.attempt_status
        ELSE 'outcome_uncertain'::autoprint_v3.attempt_status
      END,
      updated_at = now()
  WHERE id = p_attempt_id;

  IF p_outcome_status IN ('completed', 'failed') THEN
    UPDATE autoprint_v3.source_documents sd
    SET retention_until = COALESCE(sd.retention_until, now() + interval '24 hours')
    FROM autoprint_v3.print_artifacts pa
    WHERE pa.id = v_job_record.artifact_id
      AND sd.id = pa.source_document_id;

    UPDATE autoprint_v3.print_artifacts
    SET retention_until = COALESCE(retention_until, now() + interval '24 hours')
    WHERE id = v_job_record.artifact_id;
  END IF;

  INSERT INTO autoprint_v3.job_transitions
    (job_id, attempt_id, from_status, to_status, actor_type, actor_id, evidence_json)
  VALUES
    (p_job_id, p_attempt_id, v_job_record.status, p_outcome_status, 'device', p_device_id, p_evidence_json);

  RETURN true;
END;
$$;

-- 5. resolve_uncertain_print_attempt
CREATE OR REPLACE FUNCTION autoprint_v3.resolve_uncertain_print_attempt(
  p_job_id uuid,
  p_user_id uuid,
  p_outcome_status autoprint_v3.job_status,
  p_reason text,
  p_evidence_json jsonb DEFAULT '{}'::jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = autoprint_v3, public, pg_temp
AS $$
DECLARE
  v_job_record autoprint_v3.print_jobs%ROWTYPE;
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'Resolution reason is required' USING ERRCODE = 'P0003';
  END IF;

  SELECT * INTO v_job_record FROM autoprint_v3.print_jobs WHERE id = p_job_id;

  IF p_outcome_status NOT IN ('completed', 'failed') THEN
    RAISE EXCEPTION 'Operator outcome must be completed or failed' USING ERRCODE = 'P0012';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM autoprint_v3.shop_memberships
    WHERE user_id = p_user_id AND shop_id = v_job_record.shop_id AND active
  ) THEN
    RAISE EXCEPTION 'User is not an active member of this job shop' USING ERRCODE = 'P0013';
  END IF;

  IF v_job_record.status != 'needs_attention' THEN
    RAISE EXCEPTION 'Job is not in needs_attention state' USING ERRCODE = 'P0004';
  END IF;

  UPDATE autoprint_v3.print_jobs
  SET status = p_outcome_status,
      completion_source = 'operator_confirmed',
      completion_evidence_json = jsonb_build_object('reason', p_reason) || p_evidence_json,
      completed_at = (CASE WHEN p_outcome_status = 'completed' THEN now() ELSE NULL END),
      updated_at = now()
  WHERE id = p_job_id;

  UPDATE autoprint_v3.source_documents sd
  SET retention_until = COALESCE(sd.retention_until, now() + interval '24 hours')
  FROM autoprint_v3.print_artifacts pa
  WHERE pa.id = v_job_record.artifact_id
    AND sd.id = pa.source_document_id;

  UPDATE autoprint_v3.print_artifacts
  SET retention_until = COALESCE(retention_until, now() + interval '24 hours')
  WHERE id = v_job_record.artifact_id;

  INSERT INTO autoprint_v3.job_transitions (job_id, attempt_id, from_status, to_status, actor_type, actor_id, reason_code, evidence_json)
  VALUES (p_job_id, v_job_record.current_attempt_id, 'needs_attention', p_outcome_status, 'shop_user', p_user_id, p_reason, p_evidence_json);

  RETURN true;
END;
$$;

-- 6. claim_preparation_task
CREATE OR REPLACE FUNCTION autoprint_v3.claim_preparation_task(
  p_worker_id text,
  p_lease_seconds integer DEFAULT 120
)
RETURNS TABLE (
  task_id uuid,
  source_document_id uuid,
  source_object_path text,
  source_sha256 text,
  options_hash text,
  lease_token text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = autoprint_v3, public, pg_temp
AS $$
DECLARE
  v_task_record autoprint_v3.preparation_tasks%ROWTYPE;
  v_doc_record autoprint_v3.source_documents%ROWTYPE;
  v_lease_token text;
  v_lease_expiry timestamptz;
BEGIN
  SELECT * INTO v_task_record
  FROM autoprint_v3.preparation_tasks
  WHERE status IN ('pending', 'leased') AND (lease_expires_at IS NULL OR lease_expires_at < now())
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_task_record.id IS NULL THEN
    RETURN;
  END IF;

  v_lease_token := encode(extensions.gen_random_bytes(16), 'hex');
  v_lease_expiry := now() + (p_lease_seconds || ' seconds')::interval;

  UPDATE autoprint_v3.preparation_tasks
  SET status = 'leased', lease_owner = p_worker_id, lease_token = v_lease_token, lease_expires_at = v_lease_expiry, attempt_count = attempt_count + 1, updated_at = now()
  WHERE id = v_task_record.id;

  SELECT * INTO v_doc_record FROM autoprint_v3.source_documents WHERE id = v_task_record.source_document_id;

  RETURN QUERY SELECT 
    v_task_record.id,
    v_task_record.source_document_id,
    v_doc_record.object_path,
    v_doc_record.sha256,
    v_task_record.options_hash,
    v_lease_token;
END;
$$;

-- 7. complete_preparation_task
CREATE OR REPLACE FUNCTION autoprint_v3.complete_preparation_task(
  p_task_id uuid,
  p_lease_token text,
  p_artifact_object_path text,
  p_artifact_sha256 text,
  p_page_count integer,
  p_byte_size bigint,
  p_renderer_name text,
  p_renderer_version text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = autoprint_v3, public, pg_temp
AS $$
DECLARE
  v_task autoprint_v3.preparation_tasks%ROWTYPE;
  v_order_id uuid;
BEGIN
  SELECT * INTO v_task
  FROM autoprint_v3.preparation_tasks
  WHERE id = p_task_id
    AND status = 'leased'
    AND lease_token = p_lease_token
    AND lease_expires_at > now()
  FOR UPDATE;

  IF v_task.id IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO autoprint_v3.print_artifacts (
    source_document_id, object_path, sha256, preparation_version,
    renderer_name, renderer_version, logical_page_count, byte_size
  ) VALUES (
    v_task.source_document_id, p_artifact_object_path, p_artifact_sha256, 1,
    p_renderer_name, p_renderer_version, p_page_count, p_byte_size
  )
  ON CONFLICT (source_document_id, preparation_version) DO UPDATE
    SET object_path = EXCLUDED.object_path,
        sha256 = EXCLUDED.sha256,
        renderer_name = EXCLUDED.renderer_name,
        renderer_version = EXCLUDED.renderer_version,
        logical_page_count = EXCLUDED.logical_page_count,
        byte_size = EXCLUDED.byte_size;

  UPDATE autoprint_v3.preparation_tasks
  SET status = 'completed', updated_at = now()
  WHERE id = p_task_id;

  SELECT order_id INTO v_order_id
  FROM autoprint_v3.source_documents
  WHERE id = v_task.source_document_id;

  UPDATE autoprint_v3.orders
  SET status = 'ready_for_approval', updated_at = now()
  WHERE id = v_order_id;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION autoprint_v3.fail_preparation_task(
  p_task_id uuid,
  p_lease_token text,
  p_error text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = autoprint_v3, public, pg_temp
AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE autoprint_v3.preparation_tasks
  SET status = 'failed', last_error = left(p_error, 1000), updated_at = now()
  WHERE id = p_task_id
    AND status = 'leased'
    AND lease_token = p_lease_token
    AND lease_expires_at > now();
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

-- 8. consume_device_enrollment: single-use code exchange in one transaction
CREATE OR REPLACE FUNCTION autoprint_v3.consume_device_enrollment(
  p_code_hash text,
  p_display_name text,
  p_credential_hash text,
  p_expected_shop_id uuid DEFAULT NULL
)
RETURNS TABLE (device_id uuid, shop_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = autoprint_v3, public, pg_temp
AS $$
DECLARE
  v_code autoprint_v3.device_enrollment_codes%ROWTYPE;
  v_device_id uuid;
BEGIN
  SELECT * INTO v_code
  FROM autoprint_v3.device_enrollment_codes
  WHERE code_hash = p_code_hash
  FOR UPDATE;

  IF v_code.id IS NULL OR v_code.consumed_at IS NOT NULL OR v_code.expires_at <= now()
     OR (p_expected_shop_id IS NOT NULL AND v_code.shop_id != p_expected_shop_id) THEN
    RETURN;
  END IF;

  INSERT INTO autoprint_v3.devices (
    shop_id, display_name, credential_hash, status, agent_contract_version
  ) VALUES (
    v_code.shop_id, p_display_name, p_credential_hash, 'active', 3
  ) RETURNING id INTO v_device_id;

  UPDATE autoprint_v3.device_enrollment_codes
  SET consumed_at = now(), consumed_by_device_id = v_device_id
  WHERE id = v_code.id;

  RETURN QUERY SELECT v_device_id, v_code.shop_id;
END;
$$;

-- 9. finalize_source_document: idempotent upload finalization and task creation
CREATE OR REPLACE FUNCTION autoprint_v3.finalize_source_document(
  p_order_id uuid,
  p_source_document_id uuid,
  p_sha256 text,
  p_verified_byte_size bigint,
  p_page_count integer,
  p_options_hash text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = autoprint_v3, public, pg_temp
AS $$
DECLARE
  v_doc autoprint_v3.source_documents%ROWTYPE;
BEGIN
  SELECT * INTO v_doc
  FROM autoprint_v3.source_documents
  WHERE id = p_source_document_id AND order_id = p_order_id
  FOR UPDATE;

  IF v_doc.id IS NULL OR v_doc.declared_byte_size != p_verified_byte_size OR p_page_count < 1 THEN
    RETURN false;
  END IF;

  IF v_doc.finalized_at IS NOT NULL THEN
    RETURN v_doc.sha256 = p_sha256 AND v_doc.verified_byte_size = p_verified_byte_size;
  END IF;

  UPDATE autoprint_v3.source_documents
  SET verified_media_type = 'application/pdf',
      sha256 = p_sha256,
      verified_byte_size = p_verified_byte_size,
      finalized_at = now(),
      retention_until = NULL
  WHERE id = p_source_document_id;

  INSERT INTO autoprint_v3.preparation_tasks (source_document_id, options_hash, status)
  VALUES (p_source_document_id, p_options_hash, 'pending')
  ON CONFLICT (source_document_id, options_hash) DO NOTHING;

  UPDATE autoprint_v3.orders
  SET status = 'preparing', updated_at = now()
  WHERE id = p_order_id;

  RETURN true;
END;
$$;

-- 10. accept_price_quote: expiry, capability, idempotency and job creation atomically
CREATE OR REPLACE FUNCTION autoprint_v3.accept_price_quote(
  p_quote_id uuid,
  p_capability_hash text,
  p_idempotency_key_hash text,
  p_request_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = autoprint_v3, public, pg_temp
AS $$
DECLARE
  v_quote autoprint_v3.price_quotes%ROWTYPE;
  v_order autoprint_v3.orders%ROWTYPE;
  v_job autoprint_v3.print_jobs%ROWTYPE;
  v_scope text := 'accept_quote:' || p_quote_id::text;
  v_cached autoprint_v3.idempotency_keys%ROWTYPE;
  v_result jsonb;
BEGIN
  IF p_idempotency_key_hash IS NOT NULL THEN
    SELECT * INTO v_cached
    FROM autoprint_v3.idempotency_keys
    WHERE scope = v_scope AND key_hash = p_idempotency_key_hash;
    IF v_cached.id IS NOT NULL THEN
      IF v_cached.request_hash != p_request_hash THEN
        RAISE EXCEPTION 'Idempotency key was reused for a different request' USING ERRCODE = 'P0014';
      END IF;
      RETURN v_cached.response_json;
    END IF;
  END IF;

  SELECT * INTO v_quote FROM autoprint_v3.price_quotes WHERE id = p_quote_id FOR UPDATE;
  IF v_quote.id IS NULL OR v_quote.expires_at <= now() THEN
    RAISE EXCEPTION 'Quote is missing or expired' USING ERRCODE = 'P0015';
  END IF;

  SELECT * INTO v_order FROM autoprint_v3.orders WHERE id = v_quote.order_id FOR UPDATE;
  IF v_order.capability_hash != p_capability_hash OR v_order.expires_at <= now() THEN
    RAISE EXCEPTION 'Order capability mismatch' USING ERRCODE = 'P0016';
  END IF;

  SELECT * INTO v_job FROM autoprint_v3.print_jobs WHERE quote_id = p_quote_id;
  IF v_job.id IS NULL THEN
    UPDATE autoprint_v3.price_quotes SET accepted_at = COALESCE(accepted_at, now()) WHERE id = p_quote_id;
    INSERT INTO autoprint_v3.print_jobs (
      order_id, shop_id, artifact_id, quote_id, schema_version, status
    ) VALUES (
      v_order.id, v_order.shop_id, v_quote.artifact_id, v_quote.id, 3, 'waiting_for_shop'
    ) RETURNING * INTO v_job;
    UPDATE autoprint_v3.orders SET status = 'waiting_for_shop', updated_at = now() WHERE id = v_order.id;
  END IF;

  v_result := jsonb_build_object(
    'status', 'accepted', 'job_id', v_job.id, 'order_id', v_order.id,
    'job_status', v_job.status, 'idempotent', v_quote.accepted_at IS NOT NULL
  );

  IF p_idempotency_key_hash IS NOT NULL THEN
    INSERT INTO autoprint_v3.idempotency_keys (
      scope, key_hash, request_hash, response_status, response_json, expires_at
    ) VALUES (v_scope, p_idempotency_key_hash, p_request_hash, 200, v_result, now() + interval '24 hours')
    ON CONFLICT (scope, key_hash) DO NOTHING;
  END IF;

  RETURN v_result;
END;
$$;

-- 11. Shop approval/rejection with membership and transition enforcement.
CREATE OR REPLACE FUNCTION autoprint_v3.approve_print_job(p_job_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = autoprint_v3, public, pg_temp
AS $$
DECLARE
  v_job autoprint_v3.print_jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_job FROM autoprint_v3.print_jobs WHERE id = p_job_id FOR UPDATE;
  IF v_job.id IS NULL OR v_job.status != 'waiting_for_shop' THEN RETURN false; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM autoprint_v3.shop_memberships
    WHERE user_id = p_user_id AND shop_id = v_job.shop_id AND active
      AND role IN ('owner', 'staff')
  ) THEN
    RAISE EXCEPTION 'User cannot approve this shop job' USING ERRCODE = 'P0017';
  END IF;
  UPDATE autoprint_v3.print_jobs
  SET approved_at = COALESCE(approved_at, now()), approved_by_user_id = p_user_id, updated_at = now()
  WHERE id = p_job_id;
  INSERT INTO autoprint_v3.audit_events (shop_id, actor_type, actor_id, event_type, target_type, target_id)
  VALUES (v_job.shop_id, 'shop_user', p_user_id, 'JOB_APPROVED', 'print_jobs', p_job_id);
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION autoprint_v3.reject_print_job(p_job_id uuid, p_user_id uuid, p_reason text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = autoprint_v3, public, pg_temp
AS $$
DECLARE
  v_job autoprint_v3.print_jobs%ROWTYPE;
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'Rejection reason is required' USING ERRCODE = 'P0018';
  END IF;
  SELECT * INTO v_job FROM autoprint_v3.print_jobs WHERE id = p_job_id FOR UPDATE;
  IF v_job.id IS NULL OR v_job.status != 'waiting_for_shop' THEN RETURN false; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM autoprint_v3.shop_memberships
    WHERE user_id = p_user_id AND shop_id = v_job.shop_id AND active
      AND role IN ('owner', 'staff')
  ) THEN
    RAISE EXCEPTION 'User cannot reject this shop job' USING ERRCODE = 'P0019';
  END IF;
  UPDATE autoprint_v3.print_jobs
  SET status = 'rejected', failure_code = left(p_reason, 500), updated_at = now()
  WHERE id = p_job_id;
  INSERT INTO autoprint_v3.job_transitions
    (job_id, from_status, to_status, actor_type, actor_id, reason_code)
  VALUES (p_job_id, 'waiting_for_shop', 'rejected', 'shop_user', p_user_id, left(p_reason, 500));
  INSERT INTO autoprint_v3.audit_events
    (shop_id, actor_type, actor_id, event_type, target_type, target_id, metadata_json)
  VALUES (v_job.shop_id, 'shop_user', p_user_id, 'JOB_REJECTED', 'print_jobs', p_job_id,
          jsonb_build_object('reason', left(p_reason, 500)));
  UPDATE autoprint_v3.source_documents sd
  SET retention_until = COALESCE(sd.retention_until, now() + interval '24 hours')
  FROM autoprint_v3.print_artifacts pa
  WHERE pa.id = v_job.artifact_id AND sd.id = pa.source_document_id;
  UPDATE autoprint_v3.print_artifacts
  SET retention_until = COALESCE(retention_until, now() + interval '24 hours')
  WHERE id = v_job.artifact_id;
  RETURN true;
END;
$$;

-- 12. Reconcile expired device leases after crashes or machine restarts.
CREATE OR REPLACE FUNCTION autoprint_v3.mark_expired_attempts_uncertain(p_device_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = autoprint_v3, public, pg_temp
AS $$
DECLARE
  v_row record;
  v_count integer := 0;
BEGIN
  FOR v_row IN
    SELECT pa.id AS attempt_id, pj.id AS job_id, pj.shop_id
    FROM autoprint_v3.print_attempts pa
    JOIN autoprint_v3.print_jobs pj ON pj.current_attempt_id = pa.id
    WHERE pa.device_id = p_device_id
      AND pa.lease_expires_at <= now()
      AND pj.status = 'printing'
    FOR UPDATE OF pa, pj
  LOOP
    UPDATE autoprint_v3.print_attempts
    SET status = 'outcome_uncertain', updated_at = now()
    WHERE id = v_row.attempt_id;
    UPDATE autoprint_v3.print_jobs
    SET status = 'needs_attention', completion_source = NULL,
        completion_evidence_json = jsonb_build_object('reason', 'lease_expired'), updated_at = now()
    WHERE id = v_row.job_id;
    INSERT INTO autoprint_v3.job_transitions
      (job_id, attempt_id, from_status, to_status, actor_type, actor_id, reason_code)
    VALUES
      (v_row.job_id, v_row.attempt_id, 'printing', 'needs_attention', 'system', p_device_id, 'LEASE_EXPIRED');
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA autoprint_v3 FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON
  FUNCTION autoprint_v3.claim_next_print_job(uuid, integer),
  autoprint_v3.renew_print_attempt_lease(uuid, uuid, text, uuid, integer),
  autoprint_v3.advance_print_attempt(uuid, uuid, text, uuid, autoprint_v3.attempt_status, autoprint_v3.attempt_status, jsonb),
  autoprint_v3.report_print_outcome(uuid, uuid, text, uuid, autoprint_v3.job_status, autoprint_v3.completion_source, jsonb),
  autoprint_v3.resolve_uncertain_print_attempt(uuid, uuid, autoprint_v3.job_status, text, jsonb),
  autoprint_v3.consume_device_enrollment(text, text, text, uuid),
  autoprint_v3.finalize_source_document(uuid, uuid, text, bigint, integer, text),
  autoprint_v3.accept_price_quote(uuid, text, text, text),
  autoprint_v3.approve_print_job(uuid, uuid),
  autoprint_v3.reject_print_job(uuid, uuid, text),
  autoprint_v3.mark_expired_attempts_uncertain(uuid)
TO autoprint_api_role;

GRANT EXECUTE ON
  FUNCTION autoprint_v3.claim_preparation_task(text, integer),
  autoprint_v3.complete_preparation_task(uuid, text, text, text, integer, bigint, text, text),
  autoprint_v3.fail_preparation_task(uuid, text, text)
TO autoprint_worker_role;

GRANT ALL ON ALL FUNCTIONS IN SCHEMA autoprint_v3 TO service_role;

COMMIT;
