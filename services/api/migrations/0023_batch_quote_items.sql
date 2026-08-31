BEGIN;
CREATE TABLE autoprint_v3.price_quote_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES autoprint_v3.price_quotes(id) ON DELETE CASCADE,
  artifact_id uuid NOT NULL REFERENCES autoprint_v3.print_artifacts(id),
  artifact_sha256 text NOT NULL,
  options_json jsonb NOT NULL,
  options_hash text NOT NULL,
  breakdown_json jsonb NOT NULL,
  total_amount numeric(10,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT price_quote_items_quote_artifact_unique UNIQUE (quote_id, artifact_id)
);
ALTER TABLE autoprint_v3.print_jobs ADD COLUMN IF NOT EXISTS quote_item_id uuid REFERENCES autoprint_v3.price_quote_items(id);
CREATE UNIQUE INDEX IF NOT EXISTS print_jobs_quote_item_unique ON autoprint_v3.print_jobs(quote_item_id) WHERE quote_item_id IS NOT NULL;
CREATE OR REPLACE FUNCTION autoprint_v3.accept_batch_quote(p_quote_id uuid, p_capability_hash text, p_idempotency_key_hash text, p_request_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = autoprint_v3, public, pg_temp AS $$
DECLARE q autoprint_v3.price_quotes%ROWTYPE; o autoprint_v3.orders%ROWTYPE; i record; result jsonb; v_scope text := 'accept_batch_quote:' || p_quote_id::text; cached autoprint_v3.idempotency_keys%ROWTYPE; job_ids jsonb := '[]'::jsonb;
BEGIN
  IF p_idempotency_key_hash IS NOT NULL THEN SELECT * INTO cached FROM autoprint_v3.idempotency_keys WHERE scope=v_scope AND key_hash=p_idempotency_key_hash; IF cached.id IS NOT NULL THEN IF cached.request_hash <> p_request_hash THEN RAISE EXCEPTION 'Idempotency key was reused for a different request'; END IF; RETURN cached.response_json; END IF; END IF;
  SELECT * INTO q FROM autoprint_v3.price_quotes WHERE id=p_quote_id FOR UPDATE; SELECT * INTO o FROM autoprint_v3.orders WHERE id=q.order_id FOR UPDATE;
  IF q.id IS NULL OR q.expires_at<=now() OR o.capability_hash<>p_capability_hash OR o.expires_at<=now() THEN RAISE EXCEPTION 'Quote is missing, expired, or unauthorized'; END IF;
  IF NOT EXISTS (SELECT 1 FROM autoprint_v3.price_quote_items WHERE quote_id=q.id) THEN RAISE EXCEPTION 'Batch quote has no items'; END IF;
  UPDATE autoprint_v3.price_quotes SET accepted_at=COALESCE(accepted_at,now()) WHERE id=q.id;
  FOR i IN SELECT * FROM autoprint_v3.price_quote_items WHERE quote_id=q.id ORDER BY created_at LOOP
    INSERT INTO autoprint_v3.print_jobs(order_id,shop_id,artifact_id,quote_id,quote_item_id,schema_version,status,print_eligibility)
    VALUES(o.id,o.shop_id,i.artifact_id,q.id,i.id,3,'waiting_for_shop',CASE WHEN o.fulfillment_mode='remote' THEN 'check_in_required' ELSE 'counter' END)
    ON CONFLICT (quote_item_id) WHERE quote_item_id IS NOT NULL DO NOTHING;
    job_ids := job_ids || COALESCE((SELECT jsonb_agg(id) FROM autoprint_v3.print_jobs WHERE quote_item_id=i.id),'[]'::jsonb);
  END LOOP;
  UPDATE autoprint_v3.orders SET status='waiting_for_shop',updated_at=now() WHERE id=o.id;
  result:=jsonb_build_object('status','accepted','order_id',o.id,'quote_id',q.id,'job_ids',job_ids);
  IF p_idempotency_key_hash IS NOT NULL THEN INSERT INTO autoprint_v3.idempotency_keys(scope,key_hash,request_hash,response_status,response_json,expires_at) VALUES(v_scope,p_idempotency_key_hash,p_request_hash,200,result,now()+interval '24 hours') ON CONFLICT(scope,key_hash) DO NOTHING; END IF;
  RETURN result;
END; $$;
GRANT EXECUTE ON FUNCTION autoprint_v3.accept_batch_quote(uuid,text,text,text) TO autoprint_api_role;
COMMIT;
