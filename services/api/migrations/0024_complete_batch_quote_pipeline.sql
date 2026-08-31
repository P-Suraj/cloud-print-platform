-- Complete the multi-document path while preserving all public v3 contracts.
BEGIN;

-- 0001 allowed only one job per quote. Batch uniqueness is line-scoped.
ALTER TABLE autoprint_v3.print_jobs
  DROP CONSTRAINT IF EXISTS print_jobs_quote_unique;

ALTER TABLE autoprint_v3.price_quote_items ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON autoprint_v3.price_quote_items TO autoprint_api_role;
GRANT SELECT ON autoprint_v3.price_quote_items TO autoprint_worker_role;
GRANT ALL ON autoprint_v3.price_quote_items TO service_role;
CREATE POLICY api_role_quote_items ON autoprint_v3.price_quote_items
  FOR ALL TO autoprint_api_role USING (true) WITH CHECK (true);
CREATE POLICY worker_role_quote_items ON autoprint_v3.price_quote_items
  FOR SELECT TO autoprint_worker_role USING (true);
CREATE POLICY service_role_quote_items ON autoprint_v3.price_quote_items
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Persist header and lines atomically. The API calculates prices through the
-- existing pricing module; this function re-validates ownership, SHA identity,
-- and the sum before committing anything.
CREATE OR REPLACE FUNCTION autoprint_v3.create_batch_price_quote(
  p_order_id uuid,
  p_capability_hash text,
  p_rate_card_id uuid,
  p_rate_card_version integer,
  p_items jsonb,
  p_total_amount numeric,
  p_batch_options_hash text,
  p_expires_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = autoprint_v3, public, pg_temp AS $$
DECLARE
  v_order autoprint_v3.orders%ROWTYPE;
  v_quote_id uuid;
  v_first jsonb;
  v_sum numeric(10,2);
  v_items jsonb;
BEGIN
  SELECT * INTO v_order FROM autoprint_v3.orders
  WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL OR v_order.capability_hash <> p_capability_hash OR v_order.expires_at <= now() THEN
    RAISE EXCEPTION 'Order is missing, expired, or unauthorized';
  END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) < 1 OR jsonb_array_length(p_items) > 20 THEN
    RAISE EXCEPTION 'Batch quote must contain between 1 and 20 items';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) item
    LEFT JOIN autoprint_v3.print_artifacts artifact ON artifact.id = (item->>'artifact_id')::uuid
    LEFT JOIN autoprint_v3.source_documents document ON document.id = artifact.source_document_id
    WHERE artifact.id IS NULL OR document.order_id <> p_order_id
       OR artifact.source_document_id IS DISTINCT FROM (item->>'source_document_id')::uuid
       OR artifact.sha256 IS DISTINCT FROM item->>'artifact_sha256'
  ) THEN
    RAISE EXCEPTION 'Batch artifact ownership or SHA-256 mismatch';
  END IF;
  SELECT round(sum((item->>'total_amount')::numeric), 2) INTO v_sum
  FROM jsonb_array_elements(p_items) item;
  IF v_sum IS DISTINCT FROM round(p_total_amount, 2) THEN
    RAISE EXCEPTION 'Batch total does not match line totals';
  END IF;

  v_first := p_items->0;
  INSERT INTO autoprint_v3.price_quotes(
    order_id, artifact_id, artifact_sha256, options_json, options_hash,
    rate_card_id, rate_card_version, breakdown_json, total_amount, currency, expires_at
  ) VALUES (
    p_order_id, (v_first->>'artifact_id')::uuid, v_first->>'artifact_sha256',
    jsonb_build_object('batch', true, 'item_count', jsonb_array_length(p_items)),
    p_batch_options_hash, p_rate_card_id, p_rate_card_version,
    jsonb_build_object('item_count', jsonb_array_length(p_items), 'total_amount', v_sum, 'currency', 'INR'),
    v_sum, 'INR', p_expires_at
  ) RETURNING id INTO v_quote_id;

  INSERT INTO autoprint_v3.price_quote_items(
    quote_id, artifact_id, artifact_sha256, options_json, options_hash, breakdown_json, total_amount
  )
  SELECT v_quote_id, (item->>'artifact_id')::uuid, item->>'artifact_sha256',
    item->'options_json', item->>'options_hash', item->'breakdown_json', (item->>'total_amount')::numeric
  FROM jsonb_array_elements(p_items) item;

  SELECT jsonb_agg(jsonb_build_object(
    'quote_item_id', quote_item.id,
    'source_document_id', artifact.source_document_id,
    'original_file_name', source.original_file_name,
    'artifact_id', quote_item.artifact_id,
    'artifact_sha256', quote_item.artifact_sha256,
    'options', quote_item.options_json,
    'options_hash', quote_item.options_hash,
    'breakdown', quote_item.breakdown_json,
    'total_amount', quote_item.total_amount
  ) ORDER BY quote_item.created_at) INTO v_items
  FROM autoprint_v3.price_quote_items quote_item
  JOIN autoprint_v3.print_artifacts artifact ON artifact.id = quote_item.artifact_id
  JOIN autoprint_v3.source_documents source ON source.id = artifact.source_document_id
  WHERE quote_item.quote_id = v_quote_id;

  RETURN jsonb_build_object('quote_id', v_quote_id, 'items', v_items);
END;
$$;

-- Inline/serverless preparation must lease the task just finalized, not an
-- unrelated oldest task from another customer order.
CREATE OR REPLACE FUNCTION autoprint_v3.claim_preparation_task_for_document(
  p_source_document_id uuid,
  p_worker_id text,
  p_lease_seconds integer DEFAULT 120
) RETURNS TABLE (
  task_id uuid, source_document_id uuid, source_object_path text,
  source_sha256 text, options_hash text, lease_token text
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = autoprint_v3, public, pg_temp AS $$
DECLARE
  v_task autoprint_v3.preparation_tasks%ROWTYPE;
  v_doc autoprint_v3.source_documents%ROWTYPE;
  v_token text;
BEGIN
  SELECT * INTO v_task FROM autoprint_v3.preparation_tasks
  WHERE source_document_id = p_source_document_id
    AND status IN ('pending', 'leased')
    AND (lease_expires_at IS NULL OR lease_expires_at < now())
  ORDER BY created_at DESC LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF v_task.id IS NULL THEN RETURN; END IF;
  v_token := encode(extensions.gen_random_bytes(16), 'hex');
  UPDATE autoprint_v3.preparation_tasks SET status='leased', lease_owner=p_worker_id,
    lease_token=v_token, lease_expires_at=now() + (p_lease_seconds || ' seconds')::interval,
    attempt_count=attempt_count+1, updated_at=now() WHERE id=v_task.id;
  SELECT * INTO v_doc FROM autoprint_v3.source_documents WHERE id=p_source_document_id;
  RETURN QUERY SELECT v_task.id, v_task.source_document_id, v_doc.object_path,
    v_doc.sha256, v_task.options_hash, v_token;
END;
$$;

-- Same response columns as the existing Windows agent contract. Only the
-- internal option source changes from quote header to the job's quote line.
CREATE OR REPLACE FUNCTION autoprint_v3.accept_batch_quote(p_quote_id uuid, p_capability_hash text, p_idempotency_key_hash text, p_request_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=autoprint_v3,public,pg_temp AS $$
DECLARE q autoprint_v3.price_quotes%ROWTYPE; o autoprint_v3.orders%ROWTYPE; i record; result jsonb; cached autoprint_v3.idempotency_keys%ROWTYPE; job_ids jsonb := '[]'::jsonb; v_scope text := 'accept_batch_quote:' || p_quote_id::text;
BEGIN
  IF p_idempotency_key_hash IS NOT NULL THEN
    SELECT * INTO cached FROM autoprint_v3.idempotency_keys WHERE scope=v_scope AND key_hash=p_idempotency_key_hash;
    IF cached.id IS NOT NULL THEN IF cached.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key was reused for a different request'; END IF; RETURN cached.response_json; END IF;
  END IF;
  SELECT * INTO q FROM autoprint_v3.price_quotes WHERE id=p_quote_id FOR UPDATE;
  SELECT * INTO o FROM autoprint_v3.orders WHERE id=q.order_id FOR UPDATE;
  IF q.id IS NULL OR q.expires_at<=now() OR o.capability_hash<>p_capability_hash OR o.expires_at<=now() THEN RAISE EXCEPTION 'Quote is missing, expired, or unauthorized'; END IF;
  IF NOT EXISTS(SELECT 1 FROM autoprint_v3.price_quote_items WHERE quote_id=q.id) THEN RAISE EXCEPTION 'Batch quote has no items'; END IF;
  UPDATE autoprint_v3.price_quotes SET accepted_at=COALESCE(accepted_at,now()) WHERE id=q.id;
  FOR i IN SELECT * FROM autoprint_v3.price_quote_items WHERE quote_id=q.id ORDER BY created_at LOOP
    INSERT INTO autoprint_v3.print_jobs(order_id,shop_id,artifact_id,quote_id,quote_item_id,schema_version,status,print_eligibility)
      VALUES(o.id,o.shop_id,i.artifact_id,q.id,i.id,3,'waiting_for_shop',CASE WHEN o.fulfillment_mode='remote' THEN 'check_in_required' ELSE 'counter' END)
      ON CONFLICT (quote_item_id) WHERE quote_item_id IS NOT NULL DO NOTHING;
    job_ids:=job_ids||COALESCE((SELECT jsonb_agg(id) FROM autoprint_v3.print_jobs WHERE quote_item_id=i.id),'[]'::jsonb);
  END LOOP;
  UPDATE autoprint_v3.orders SET status='waiting_for_shop',updated_at=now() WHERE id=o.id;
  result:=jsonb_build_object('status','accepted','order_id',o.id,'quote_id',q.id,'job_ids',job_ids);
  IF p_idempotency_key_hash IS NOT NULL THEN INSERT INTO autoprint_v3.idempotency_keys(scope,key_hash,request_hash,response_status,response_json,expires_at) VALUES(v_scope,p_idempotency_key_hash,p_request_hash,200,result,now()+interval '24 hours') ON CONFLICT(scope,key_hash) DO NOTHING; END IF;
  RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION autoprint_v3.claim_next_print_job(
  p_device_id uuid, p_lease_seconds integer DEFAULT 300
) RETURNS TABLE (
  job_id uuid, attempt_id uuid, fencing_token text, artifact_sha256 text,
  artifact_object_path text, options_json jsonb, lease_expires_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = autoprint_v3, public, pg_temp AS $$
DECLARE
  v_device_shop_id uuid; v_device_status autoprint_v3.device_status;
  v_job autoprint_v3.print_jobs%ROWTYPE; v_artifact autoprint_v3.print_artifacts%ROWTYPE;
  v_quote autoprint_v3.price_quotes%ROWTYPE; v_item autoprint_v3.price_quote_items%ROWTYPE;
  v_token text; v_attempt_id uuid; v_expiry timestamptz; v_options jsonb; v_options_hash text;
BEGIN
  SELECT shop_id,status INTO v_device_shop_id,v_device_status FROM autoprint_v3.devices WHERE id=p_device_id;
  IF v_device_shop_id IS NULL OR v_device_status <> 'active' THEN RAISE EXCEPTION 'Device % is invalid or revoked',p_device_id; END IF;
  SELECT pj.* INTO v_job FROM autoprint_v3.print_jobs pj
  JOIN autoprint_v3.orders ord ON ord.id=pj.order_id
  WHERE pj.shop_id=v_device_shop_id AND pj.status='waiting_for_shop' AND pj.approved_at IS NOT NULL
    AND pj.current_attempt_id IS NULL
    AND (pj.print_eligibility IN ('counter','shop_risk_accepted') OR ord.customer_checked_in_at IS NOT NULL)
  ORDER BY pj.created_at LIMIT 1 FOR UPDATE OF pj SKIP LOCKED;
  IF v_job.id IS NULL THEN RETURN; END IF;
  SELECT * INTO v_artifact FROM autoprint_v3.print_artifacts WHERE id=v_job.artifact_id;
  SELECT * INTO v_quote FROM autoprint_v3.price_quotes WHERE id=v_job.quote_id;
  IF v_job.quote_item_id IS NOT NULL THEN SELECT * INTO v_item FROM autoprint_v3.price_quote_items WHERE id=v_job.quote_item_id; END IF;
  v_options := COALESCE(v_job.shop_options_override_json, v_item.options_json, v_quote.options_json);
  v_options_hash := COALESCE(v_job.shop_options_override_hash, v_item.options_hash, v_quote.options_hash);
  v_token := encode(extensions.gen_random_bytes(16),'hex'); v_expiry := now()+(p_lease_seconds||' seconds')::interval;
  INSERT INTO autoprint_v3.print_attempts(job_id,device_id,fencing_token,status,lease_expires_at,last_renewed_at,artifact_sha256,options_hash)
    VALUES(v_job.id,p_device_id,v_token,'leased',v_expiry,now(),v_artifact.sha256,v_options_hash) RETURNING id INTO v_attempt_id;
  UPDATE autoprint_v3.print_jobs SET status='printing',current_attempt_id=v_attempt_id,updated_at=now() WHERE id=v_job.id;
  INSERT INTO autoprint_v3.job_transitions(job_id,attempt_id,from_status,to_status,actor_type,actor_id,reason_code)
    VALUES(v_job.id,v_attempt_id,'waiting_for_shop','printing','device',p_device_id,'CLAIM_SUCCESS');
  INSERT INTO autoprint_v3.audit_events(shop_id,actor_type,actor_id,event_type,target_type,target_id)
    VALUES(v_device_shop_id,'device',p_device_id,'JOB_CLAIMED','print_jobs',v_job.id);
  RETURN QUERY SELECT v_job.id,v_attempt_id,v_token,v_artifact.sha256,v_artifact.object_path,v_options,v_expiry;
END;
$$;

-- Cancel all still-unclaimed lines as one order. This keeps the existing RPC
-- signature and cancellation ledger while extending its atomic scope.
CREATE OR REPLACE FUNCTION autoprint_v3.cancel_print_job_if_unclaimed(
  p_order_id uuid,p_capability_hash text,p_customer_id uuid,p_idempotency_key_hash text,p_request_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=autoprint_v3,public,extensions,pg_temp AS $$
DECLARE
  v_order autoprint_v3.orders%ROWTYPE; v_existing autoprint_v3.cancellations%ROWTYPE;
  v_first_job_id uuid; v_actor uuid; v_result jsonb; v_job_ids jsonb;
BEGIN
  SELECT * INTO v_existing FROM autoprint_v3.cancellations WHERE order_id=p_order_id AND idempotency_key_hash=p_idempotency_key_hash;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused'; END IF;
    RETURN v_existing.result_json;
  END IF;
  SELECT * INTO v_order FROM autoprint_v3.orders WHERE id=p_order_id FOR UPDATE;
  IF v_order.id IS NULL OR v_order.capability_hash<>p_capability_hash THEN RETURN jsonb_build_object('result','not_found'); END IF;
  IF v_order.customer_id IS NOT NULL AND (p_customer_id IS NULL OR v_order.customer_id<>p_customer_id) THEN RETURN jsonb_build_object('result','not_found'); END IF;
  v_actor:=v_order.customer_id;
  PERFORM id FROM autoprint_v3.print_jobs WHERE order_id=p_order_id FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM autoprint_v3.print_jobs WHERE order_id=p_order_id) THEN RETURN jsonb_build_object('result','not_cancellable'); END IF;
  IF EXISTS(SELECT 1 FROM autoprint_v3.print_jobs WHERE order_id=p_order_id AND (status<>'waiting_for_shop' OR current_attempt_id IS NOT NULL)) THEN
    RETURN jsonb_build_object('result','execution_started','order_id',p_order_id);
  END IF;
  SELECT id INTO v_first_job_id FROM autoprint_v3.print_jobs WHERE order_id=p_order_id ORDER BY created_at,id LIMIT 1;
  SELECT jsonb_agg(id ORDER BY created_at,id) INTO v_job_ids FROM autoprint_v3.print_jobs WHERE order_id=p_order_id;
  INSERT INTO autoprint_v3.job_transitions(job_id,from_status,to_status,actor_type,actor_id,reason_code)
    SELECT id,'waiting_for_shop','cancelled','anonymous_customer',v_actor,'CUSTOMER_CANCELLED_BEFORE_CLAIM'
    FROM autoprint_v3.print_jobs WHERE order_id=p_order_id;
  UPDATE autoprint_v3.print_jobs SET status='cancelled',updated_at=now() WHERE order_id=p_order_id;
  UPDATE autoprint_v3.orders SET status='cancelled',updated_at=now() WHERE id=p_order_id;
  UPDATE autoprint_v3.source_documents SET retention_until=COALESCE(retention_until,now()+interval '24 hours') WHERE order_id=p_order_id;
  UPDATE autoprint_v3.print_artifacts artifact SET retention_until=COALESCE(artifact.retention_until,now()+interval '24 hours')
    FROM autoprint_v3.source_documents source WHERE source.order_id=p_order_id AND artifact.source_document_id=source.id;
  v_result:=jsonb_build_object('result','cancelled','order_id',p_order_id,'job_id',v_first_job_id,'job_ids',v_job_ids);
  INSERT INTO autoprint_v3.cancellations(order_id,job_id,customer_id,idempotency_key_hash,request_hash,result_json)
    VALUES(p_order_id,v_first_job_id,v_actor,p_idempotency_key_hash,p_request_hash,v_result);
  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION autoprint_v3.create_batch_price_quote(uuid,text,uuid,integer,jsonb,numeric,text,timestamptz) TO autoprint_api_role;
GRANT EXECUTE ON FUNCTION autoprint_v3.claim_preparation_task_for_document(uuid,text,integer) TO autoprint_api_role, autoprint_worker_role;
GRANT EXECUTE ON FUNCTION autoprint_v3.claim_next_print_job(uuid,integer) TO autoprint_api_role;
GRANT EXECUTE ON FUNCTION autoprint_v3.cancel_print_job_if_unclaimed(uuid,text,uuid,text,text) TO autoprint_api_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
