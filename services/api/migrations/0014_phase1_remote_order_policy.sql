-- Phase 1 completion: verified customers, remote intake policy,
-- print-on-arrival eligibility, customer check-in and audited shop risk.

BEGIN;

CREATE TABLE autoprint_v3.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_provider text NOT NULL,
  identity_subject text NOT NULL,
  email text,
  phone text,
  verified_at timestamptz NOT NULL,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customers_identity_unique UNIQUE (identity_provider, identity_subject)
);

CREATE TABLE autoprint_v3.customer_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES autoprint_v3.customers(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  csrf_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_active_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE autoprint_v3.shop_remote_policies (
  shop_id uuid PRIMARY KEY REFERENCES public.shops(id) ON DELETE CASCADE,
  remote_orders_enabled boolean NOT NULL DEFAULT false,
  remote_orders_paused boolean NOT NULL DEFAULT false,
  unpaid_policy text NOT NULL DEFAULT 'print_on_arrival' CHECK (unpaid_policy = 'print_on_arrival'),
  version integer NOT NULL DEFAULT 1,
  updated_by_user_id uuid REFERENCES autoprint_v3.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE autoprint_v3.orders
  ADD COLUMN customer_id uuid REFERENCES autoprint_v3.customers(id),
  ADD COLUMN fulfillment_mode text NOT NULL DEFAULT 'counter' CHECK (fulfillment_mode IN ('counter','remote')),
  ADD COLUMN payment_mode text NOT NULL DEFAULT 'pay_at_pickup' CHECK (payment_mode = 'pay_at_pickup'),
  ADD COLUMN remote_policy_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN customer_checked_in_at timestamptz,
  ADD CONSTRAINT orders_remote_customer_check CHECK (fulfillment_mode != 'remote' OR customer_id IS NOT NULL);

ALTER TABLE autoprint_v3.print_jobs
  ADD COLUMN print_eligibility text NOT NULL DEFAULT 'counter' CHECK (print_eligibility IN ('counter','check_in_required','shop_risk_accepted')),
  ADD COLUMN shop_risk_accepted_at timestamptz,
  ADD COLUMN shop_risk_accepted_by_user_id uuid REFERENCES autoprint_v3.users(id),
  ADD COLUMN shop_risk_reason text;

CREATE INDEX idx_customer_sessions_token ON autoprint_v3.customer_sessions(token_hash) WHERE revoked_at IS NULL;
CREATE INDEX idx_orders_customer_created ON autoprint_v3.orders(customer_id,created_at DESC) WHERE customer_id IS NOT NULL;
CREATE INDEX idx_jobs_print_eligibility ON autoprint_v3.print_jobs(shop_id,print_eligibility,created_at) WHERE status='waiting_for_shop';

ALTER TABLE autoprint_v3.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE autoprint_v3.customer_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE autoprint_v3.shop_remote_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY api_role_customers ON autoprint_v3.customers FOR ALL TO autoprint_api_role USING (true) WITH CHECK (true);
CREATE POLICY api_role_customer_sessions ON autoprint_v3.customer_sessions FOR ALL TO autoprint_api_role USING (true) WITH CHECK (true);
CREATE POLICY api_role_remote_policies ON autoprint_v3.shop_remote_policies FOR ALL TO autoprint_api_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_customers ON autoprint_v3.customers FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_customer_sessions ON autoprint_v3.customer_sessions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_remote_policies ON autoprint_v3.shop_remote_policies FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT,INSERT,UPDATE ON autoprint_v3.customers,autoprint_v3.customer_sessions,autoprint_v3.shop_remote_policies TO autoprint_api_role;
GRANT ALL ON autoprint_v3.customers,autoprint_v3.customer_sessions,autoprint_v3.shop_remote_policies TO service_role;

CREATE OR REPLACE FUNCTION autoprint_v3.create_customer_order_v3(
  p_shop_id uuid,p_capability_hash text,p_permissions jsonb,p_expires_at timestamptz,
  p_submission_channel text,p_fulfillment_mode text,p_customer_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=autoprint_v3,public,extensions,pg_temp AS $$
DECLARE v_policy autoprint_v3.shop_remote_policies%ROWTYPE;v_order autoprint_v3.orders%ROWTYPE;v_snapshot jsonb:='{}'::jsonb;
BEGIN
  IF p_submission_channel NOT IN('qr','shop_code','saved_shop') OR p_fulfillment_mode NOT IN('counter','remote')
  THEN RAISE EXCEPTION 'Invalid order channel or fulfillment mode' USING ERRCODE='P0028'; END IF;
  IF p_fulfillment_mode='remote' THEN
    IF p_customer_id IS NULL OR p_submission_channel='qr' THEN RAISE EXCEPTION 'Verified remote customer required' USING ERRCODE='P0029'; END IF;
    SELECT * INTO v_policy FROM autoprint_v3.shop_remote_policies WHERE shop_id=p_shop_id FOR SHARE;
    IF v_policy.shop_id IS NULL OR NOT v_policy.remote_orders_enabled OR v_policy.remote_orders_paused
    THEN RAISE EXCEPTION 'Remote orders are disabled or paused' USING ERRCODE='P0034'; END IF;
    v_snapshot:=jsonb_build_object('version',v_policy.version,'unpaid_policy',v_policy.unpaid_policy,'captured_at',now());
  ELSIF p_submission_channel!='qr' THEN
    RAISE EXCEPTION 'Non-QR entry must be remote' USING ERRCODE='P0035';
  END IF;
  INSERT INTO autoprint_v3.orders(shop_id,capability_hash,capability_permissions,schema_version,status,expires_at,
    submission_channel,customer_id,fulfillment_mode,payment_mode,remote_policy_snapshot)
  VALUES(p_shop_id,p_capability_hash,p_permissions,3,'uploading',p_expires_at,p_submission_channel,p_customer_id,
    p_fulfillment_mode,'pay_at_pickup',v_snapshot) RETURNING * INTO v_order;
  INSERT INTO autoprint_v3.audit_events(shop_id,actor_type,actor_id,event_type,target_type,target_id,metadata_json)
  VALUES(p_shop_id,'anonymous_customer',p_customer_id,
    CASE WHEN p_fulfillment_mode='remote' THEN 'REMOTE_ORDER_OPENED' ELSE 'COUNTER_ORDER_OPENED' END,
    'orders',v_order.id,jsonb_build_object('submission_channel',p_submission_channel,'fulfillment_mode',p_fulfillment_mode));
  RETURN to_jsonb(v_order);
END $$;

CREATE OR REPLACE FUNCTION autoprint_v3.set_shop_remote_policy(
  p_shop_id uuid,p_user_id uuid,p_enabled boolean,p_paused boolean,p_unpaid_policy text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=autoprint_v3,public,extensions,pg_temp AS $$
DECLARE v_policy autoprint_v3.shop_remote_policies%ROWTYPE;
BEGIN
  IF p_unpaid_policy!='print_on_arrival' THEN RAISE EXCEPTION 'Unsupported unpaid policy' USING ERRCODE='P0030'; END IF;
  IF NOT EXISTS(SELECT 1 FROM autoprint_v3.shop_memberships WHERE shop_id=p_shop_id AND user_id=p_user_id AND active AND role IN('owner','staff'))
  THEN RAISE EXCEPTION 'User cannot change this policy' USING ERRCODE='P0031'; END IF;
  INSERT INTO autoprint_v3.shop_remote_policies(shop_id,remote_orders_enabled,remote_orders_paused,unpaid_policy,updated_by_user_id)
  VALUES(p_shop_id,p_enabled,p_paused,p_unpaid_policy,p_user_id)
  ON CONFLICT(shop_id) DO UPDATE SET remote_orders_enabled=EXCLUDED.remote_orders_enabled,
    remote_orders_paused=EXCLUDED.remote_orders_paused,unpaid_policy=EXCLUDED.unpaid_policy,
    version=autoprint_v3.shop_remote_policies.version+1,updated_by_user_id=EXCLUDED.updated_by_user_id,updated_at=now()
  RETURNING * INTO v_policy;
  INSERT INTO autoprint_v3.audit_events(shop_id,actor_type,actor_id,event_type,target_type,target_id,metadata_json)
  VALUES(p_shop_id,'shop_user',p_user_id,'REMOTE_POLICY_UPDATED','shop_remote_policies',p_shop_id,
    jsonb_build_object('enabled',p_enabled,'paused',p_paused,'unpaid_policy',p_unpaid_policy,'version',v_policy.version));
  RETURN to_jsonb(v_policy);
END $$;

CREATE OR REPLACE FUNCTION autoprint_v3.accept_unpaid_preprint_risk(p_job_id uuid,p_user_id uuid,p_reason text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path=autoprint_v3,public,extensions,pg_temp AS $$
DECLARE v_job autoprint_v3.print_jobs%ROWTYPE;v_order autoprint_v3.orders%ROWTYPE;
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason))=0 THEN RAISE EXCEPTION 'Reason required' USING ERRCODE='P0032'; END IF;
  SELECT * INTO v_job FROM autoprint_v3.print_jobs WHERE id=p_job_id FOR UPDATE;
  IF v_job.id IS NULL OR v_job.status!='waiting_for_shop' OR v_job.current_attempt_id IS NOT NULL THEN RETURN false; END IF;
  SELECT * INTO v_order FROM autoprint_v3.orders WHERE id=v_job.order_id;
  IF v_order.fulfillment_mode!='remote' OR v_job.print_eligibility!='check_in_required' THEN RETURN false; END IF;
  IF NOT EXISTS(SELECT 1 FROM autoprint_v3.shop_memberships WHERE shop_id=v_job.shop_id AND user_id=p_user_id AND active AND role IN('owner','staff'))
  THEN RAISE EXCEPTION 'User cannot accept risk' USING ERRCODE='P0033'; END IF;
  UPDATE autoprint_v3.print_jobs SET print_eligibility='shop_risk_accepted',shop_risk_accepted_at=now(),
    shop_risk_accepted_by_user_id=p_user_id,shop_risk_reason=left(trim(p_reason),500),updated_at=now() WHERE id=p_job_id;
  INSERT INTO autoprint_v3.audit_events(shop_id,actor_type,actor_id,event_type,target_type,target_id,metadata_json)
  VALUES(v_job.shop_id,'shop_user',p_user_id,'UNPAID_PREPRINT_RISK_ACCEPTED','print_jobs',p_job_id,jsonb_build_object('reason',left(trim(p_reason),500)));
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION autoprint_v3.check_in_remote_order(p_order_id uuid,p_capability_hash text,p_customer_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path=autoprint_v3,public,extensions,pg_temp AS $$
DECLARE v_order autoprint_v3.orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM autoprint_v3.orders WHERE id=p_order_id FOR UPDATE;
  IF v_order.id IS NULL OR v_order.capability_hash!=p_capability_hash OR v_order.customer_id!=p_customer_id THEN RETURN false; END IF;
  IF v_order.fulfillment_mode!='remote' OR v_order.status IN('printing','completed','failed','rejected','cancelled') THEN RETURN false; END IF;
  UPDATE autoprint_v3.orders SET customer_checked_in_at=COALESCE(customer_checked_in_at,now()),updated_at=now() WHERE id=p_order_id;
  INSERT INTO autoprint_v3.audit_events(shop_id,actor_type,actor_id,event_type,target_type,target_id)
  VALUES(v_order.shop_id,'anonymous_customer',p_customer_id,'REMOTE_CUSTOMER_CHECKED_IN','orders',p_order_id);
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION autoprint_v3.accept_price_quote(p_quote_id uuid,p_capability_hash text,p_idempotency_key_hash text,p_request_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=autoprint_v3,public,extensions,pg_temp AS $$
DECLARE v_quote autoprint_v3.price_quotes%ROWTYPE;v_order autoprint_v3.orders%ROWTYPE;v_job autoprint_v3.print_jobs%ROWTYPE;
  v_scope text:='accept_quote:'||p_quote_id::text;v_cached autoprint_v3.idempotency_keys%ROWTYPE;v_result jsonb;v_eligibility text;
BEGIN
  IF p_idempotency_key_hash IS NOT NULL THEN
    SELECT * INTO v_cached FROM autoprint_v3.idempotency_keys WHERE scope=v_scope AND key_hash=p_idempotency_key_hash;
    IF v_cached.id IS NOT NULL THEN
      IF v_cached.request_hash!=p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused' USING ERRCODE='P0014'; END IF;
      RETURN v_cached.response_json;
    END IF;
  END IF;
  SELECT * INTO v_quote FROM autoprint_v3.price_quotes WHERE id=p_quote_id FOR UPDATE;
  IF v_quote.id IS NULL OR v_quote.expires_at<=now() THEN RAISE EXCEPTION 'Quote missing or expired' USING ERRCODE='P0015'; END IF;
  SELECT * INTO v_order FROM autoprint_v3.orders WHERE id=v_quote.order_id FOR UPDATE;
  IF v_order.capability_hash!=p_capability_hash OR v_order.expires_at<=now() THEN RAISE EXCEPTION 'Order capability mismatch' USING ERRCODE='P0016'; END IF;
  v_eligibility:=CASE WHEN v_order.fulfillment_mode='remote' THEN 'check_in_required' ELSE 'counter' END;
  SELECT * INTO v_job FROM autoprint_v3.print_jobs WHERE quote_id=p_quote_id;
  IF v_job.id IS NULL THEN
    UPDATE autoprint_v3.price_quotes SET accepted_at=COALESCE(accepted_at,now()) WHERE id=p_quote_id;
    INSERT INTO autoprint_v3.print_jobs(order_id,shop_id,artifact_id,quote_id,schema_version,status,print_eligibility)
    VALUES(v_order.id,v_order.shop_id,v_quote.artifact_id,v_quote.id,3,'waiting_for_shop',v_eligibility) RETURNING * INTO v_job;
    UPDATE autoprint_v3.orders SET status='waiting_for_shop',updated_at=now() WHERE id=v_order.id;
  END IF;
  v_result:=jsonb_build_object('status','accepted','job_id',v_job.id,'order_id',v_order.id,'job_status',v_job.status,'print_eligibility',v_job.print_eligibility);
  IF p_idempotency_key_hash IS NOT NULL THEN
    INSERT INTO autoprint_v3.idempotency_keys(scope,key_hash,request_hash,response_status,response_json,expires_at)
    VALUES(v_scope,p_idempotency_key_hash,p_request_hash,200,v_result,now()+interval '24 hours') ON CONFLICT(scope,key_hash) DO NOTHING;
  END IF;
  RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION autoprint_v3.claim_next_print_job(p_device_id uuid,p_lease_seconds integer DEFAULT 300)
RETURNS TABLE(job_id uuid,attempt_id uuid,fencing_token text,artifact_sha256 text,artifact_object_path text,options_json jsonb,lease_expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=autoprint_v3,public,extensions,pg_temp AS $$
DECLARE v_shop uuid;v_device_status autoprint_v3.device_status;v_job autoprint_v3.print_jobs%ROWTYPE;
  v_artifact autoprint_v3.print_artifacts%ROWTYPE;v_quote autoprint_v3.price_quotes%ROWTYPE;v_fence text;v_attempt uuid;v_expiry timestamptz;
BEGIN
  SELECT shop_id,status INTO v_shop,v_device_status FROM autoprint_v3.devices WHERE id=p_device_id;
  IF v_shop IS NULL OR v_device_status!='active' THEN RAISE EXCEPTION 'Device invalid or revoked' USING ERRCODE='P0001'; END IF;
  SELECT pj.* INTO v_job FROM autoprint_v3.print_jobs pj JOIN autoprint_v3.orders o ON o.id=pj.order_id
  WHERE pj.shop_id=v_shop AND pj.status='waiting_for_shop' AND pj.approved_at IS NOT NULL AND pj.current_attempt_id IS NULL
    AND(pj.print_eligibility IN('counter','shop_risk_accepted') OR o.customer_checked_in_at IS NOT NULL)
  ORDER BY pj.created_at LIMIT 1 FOR UPDATE OF pj SKIP LOCKED;
  IF v_job.id IS NULL THEN RETURN; END IF;
  v_fence:=encode(extensions.gen_random_bytes(16),'hex');v_expiry:=now()+(p_lease_seconds||' seconds')::interval;
  SELECT * INTO v_artifact FROM autoprint_v3.print_artifacts WHERE id=v_job.artifact_id;
  SELECT * INTO v_quote FROM autoprint_v3.price_quotes WHERE id=v_job.quote_id;
  INSERT INTO autoprint_v3.print_attempts(job_id,device_id,fencing_token,status,lease_expires_at,last_renewed_at,artifact_sha256,options_hash)
  VALUES(v_job.id,p_device_id,v_fence,'leased',v_expiry,now(),v_artifact.sha256,v_quote.options_hash) RETURNING id INTO v_attempt;
  UPDATE autoprint_v3.print_jobs SET status='printing',current_attempt_id=v_attempt,updated_at=now() WHERE id=v_job.id;
  INSERT INTO autoprint_v3.job_transitions(job_id,attempt_id,from_status,to_status,actor_type,actor_id,reason_code)
  VALUES(v_job.id,v_attempt,'waiting_for_shop','printing','device',p_device_id,'CLAIM_SUCCESS');
  INSERT INTO autoprint_v3.audit_events(shop_id,actor_type,actor_id,event_type,target_type,target_id)
  VALUES(v_shop,'device',p_device_id,'JOB_CLAIMED','print_jobs',v_job.id);
  RETURN QUERY SELECT v_job.id,v_attempt,v_fence,v_artifact.sha256,v_artifact.object_path,v_quote.options_json,v_expiry;
END $$;

GRANT EXECUTE ON FUNCTION autoprint_v3.set_shop_remote_policy(uuid,uuid,boolean,boolean,text) TO autoprint_api_role,service_role;
GRANT EXECUTE ON FUNCTION autoprint_v3.create_customer_order_v3(uuid,text,jsonb,timestamptz,text,text,uuid) TO autoprint_api_role,service_role;
GRANT EXECUTE ON FUNCTION autoprint_v3.accept_unpaid_preprint_risk(uuid,uuid,text) TO autoprint_api_role,service_role;
GRANT EXECUTE ON FUNCTION autoprint_v3.check_in_remote_order(uuid,text,uuid) TO autoprint_api_role,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
