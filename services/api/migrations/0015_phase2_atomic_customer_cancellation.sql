-- Phase 2: atomic, idempotent cancellation before a device attempt exists.

BEGIN;

CREATE TABLE autoprint_v3.cancellations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES autoprint_v3.orders(id),
  job_id uuid NOT NULL UNIQUE REFERENCES autoprint_v3.print_jobs(id),
  customer_id uuid REFERENCES autoprint_v3.customers(id),
  idempotency_key_hash text NOT NULL,
  request_hash text NOT NULL,
  result_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cancellations_order_key_unique UNIQUE(order_id,idempotency_key_hash)
);

ALTER TABLE autoprint_v3.cancellations ENABLE ROW LEVEL SECURITY;
CREATE POLICY api_role_cancellations ON autoprint_v3.cancellations FOR ALL TO autoprint_api_role USING(true) WITH CHECK(true);
CREATE POLICY service_role_cancellations ON autoprint_v3.cancellations FOR ALL TO service_role USING(true) WITH CHECK(true);
GRANT SELECT,INSERT ON autoprint_v3.cancellations TO autoprint_api_role;
GRANT ALL ON autoprint_v3.cancellations TO service_role;

CREATE OR REPLACE FUNCTION autoprint_v3.cancel_print_job_if_unclaimed(
  p_order_id uuid,p_capability_hash text,p_customer_id uuid,p_idempotency_key_hash text,p_request_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=autoprint_v3,public,extensions,pg_temp AS $$
DECLARE v_order autoprint_v3.orders%ROWTYPE;v_job autoprint_v3.print_jobs%ROWTYPE;
  v_existing autoprint_v3.cancellations%ROWTYPE;v_result jsonb;v_actor uuid;
BEGIN
  SELECT * INTO v_existing FROM autoprint_v3.cancellations
  WHERE order_id=p_order_id AND idempotency_key_hash=p_idempotency_key_hash;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.request_hash!=p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused' USING ERRCODE='P0040'; END IF;
    RETURN v_existing.result_json;
  END IF;

  SELECT * INTO v_order FROM autoprint_v3.orders WHERE id=p_order_id FOR UPDATE;
  IF v_order.id IS NULL OR v_order.capability_hash!=p_capability_hash THEN RETURN jsonb_build_object('result','not_found'); END IF;
  IF v_order.customer_id IS NOT NULL AND(p_customer_id IS NULL OR v_order.customer_id!=p_customer_id)
  THEN RETURN jsonb_build_object('result','not_found'); END IF;
  v_actor:=v_order.customer_id;

  -- claim_next_print_job locks this same row. Whichever transaction obtains it
  -- first changes the predicate so the other operation fails closed.
  SELECT * INTO v_job FROM autoprint_v3.print_jobs WHERE order_id=p_order_id FOR UPDATE;
  IF v_job.id IS NULL THEN RETURN jsonb_build_object('result','not_cancellable'); END IF;
  IF v_job.status='cancelled' THEN RETURN jsonb_build_object('result','already_cancelled','order_id',p_order_id,'job_id',v_job.id); END IF;
  IF v_job.status!='waiting_for_shop' OR v_job.current_attempt_id IS NOT NULL
  THEN RETURN jsonb_build_object('result','execution_started','order_id',p_order_id,'job_id',v_job.id); END IF;

  UPDATE autoprint_v3.print_jobs SET status='cancelled',updated_at=now() WHERE id=v_job.id;
  UPDATE autoprint_v3.orders SET status='cancelled',updated_at=now() WHERE id=p_order_id;
  INSERT INTO autoprint_v3.job_transitions(job_id,from_status,to_status,actor_type,actor_id,reason_code)
  VALUES(v_job.id,'waiting_for_shop','cancelled','anonymous_customer',v_actor,'CUSTOMER_CANCELLED_BEFORE_CLAIM');
  INSERT INTO autoprint_v3.audit_events(shop_id,actor_type,actor_id,event_type,target_type,target_id)
  VALUES(v_job.shop_id,'anonymous_customer',v_actor,'CUSTOMER_ORDER_CANCELLED','print_jobs',v_job.id);
  UPDATE autoprint_v3.source_documents sd SET retention_until=COALESCE(sd.retention_until,now()+interval '24 hours')
  FROM autoprint_v3.print_artifacts pa WHERE pa.id=v_job.artifact_id AND sd.id=pa.source_document_id;
  UPDATE autoprint_v3.print_artifacts SET retention_until=COALESCE(retention_until,now()+interval '24 hours') WHERE id=v_job.artifact_id;
  v_result:=jsonb_build_object('result','cancelled','order_id',p_order_id,'job_id',v_job.id);
  INSERT INTO autoprint_v3.cancellations(order_id,job_id,customer_id,idempotency_key_hash,request_hash,result_json)
  VALUES(p_order_id,v_job.id,v_actor,p_idempotency_key_hash,p_request_hash,v_result);
  RETURN v_result;
END $$;

GRANT EXECUTE ON FUNCTION autoprint_v3.cancel_print_job_if_unclaimed(uuid,text,uuid,text,text) TO autoprint_api_role,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
