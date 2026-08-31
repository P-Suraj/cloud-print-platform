-- Migration 0016: Phase 3 — Pickup, Collection and No-Show Workflow
-- Creates all pickup lifecycle tables, security-definer RPCs and grants.
-- Every terminal state timestamp is constrained to its matching status.
-- Feature flag (pickup_workflow_enabled) is checked inside every RPC;
-- disabling the flag preserves all history and stops new automated actions.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. SHOP PICKUP POLICIES
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE autoprint_v3.shop_pickup_policies (
  shop_id                        uuid     PRIMARY KEY REFERENCES public.shops(id) ON DELETE CASCADE,
  pickup_workflow_enabled        boolean  NOT NULL DEFAULT false,
  hold_period_minutes            integer  NOT NULL DEFAULT 4320          -- 72 hours
    CHECK (hold_period_minutes BETWEEN 720 AND 20160),                   -- 12 h – 14 days
  reminder_offsets_minutes       jsonb    NOT NULL DEFAULT '[]'::jsonb,
  no_show_disables_unpaid_preprint boolean NOT NULL DEFAULT true,
  policy_version                 integer  NOT NULL DEFAULT 1,
  updated_by_user_id             uuid     REFERENCES autoprint_v3.users(id),
  created_at                     timestamptz NOT NULL DEFAULT now(),
  updated_at                     timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. PICKUPS
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE autoprint_v3.pickup_status AS ENUM (
    'awaiting_print',
    'ready_for_pickup',
    'collected',
    'hold_expired',
    'no_show',
    'voided'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE autoprint_v3.pickups (
  id                     uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id               uuid            NOT NULL UNIQUE REFERENCES autoprint_v3.orders(id),
  job_id                 uuid            NOT NULL UNIQUE REFERENCES autoprint_v3.print_jobs(id),
  shop_id                uuid            NOT NULL REFERENCES public.shops(id),
  customer_id            uuid            REFERENCES autoprint_v3.customers(id),
  status                 autoprint_v3.pickup_status NOT NULL DEFAULT 'awaiting_print',
  policy_snapshot_json   jsonb           NOT NULL DEFAULT '{}'::jsonb,
  policy_version         integer         NOT NULL DEFAULT 0,
  -- Secure code storage: plaintext never stored
  code_hash              text,           -- SHA-256(code.upper() + ":" + id::text)
  code_key_version       integer         NOT NULL DEFAULT 1,
  -- Lifecycle timestamps
  ready_at               timestamptz,
  hold_until             timestamptz,
  hold_expired_at        timestamptz,
  collected_at           timestamptz,
  collected_by_user_id   uuid            REFERENCES autoprint_v3.users(id),
  collection_method      text            CHECK (collection_method IN ('code', 'qr', 'manual_override')),
  no_show_at             timestamptz,
  no_show_by_user_id     uuid            REFERENCES autoprint_v3.users(id),
  no_show_reason         text,
  voided_at              timestamptz,
  void_reason            text,
  -- Optimistic locking
  version                integer         NOT NULL DEFAULT 1,
  created_at             timestamptz     NOT NULL DEFAULT now(),
  updated_at             timestamptz     NOT NULL DEFAULT now(),
  -- Terminal state consistency: timestamps must match their states
  CONSTRAINT pickup_collected_consistency CHECK (
    (status = 'collected') = (collected_at IS NOT NULL)
  ),
  CONSTRAINT pickup_no_show_consistency CHECK (
    (status = 'no_show') = (no_show_at IS NOT NULL)
  ),
  CONSTRAINT pickup_voided_consistency CHECK (
    (status = 'voided') = (voided_at IS NOT NULL)
  ),
  CONSTRAINT pickup_ready_requires_times CHECK (
    status NOT IN ('ready_for_pickup','collected','hold_expired','no_show')
    OR (ready_at IS NOT NULL AND hold_until IS NOT NULL)
  ),
  CONSTRAINT pickup_no_show_requires_reason CHECK (
    no_show_at IS NULL OR (no_show_reason IS NOT NULL AND length(trim(no_show_reason)) >= 10)
  ),
  CONSTRAINT pickup_collect_requires_method CHECK (
    collected_at IS NULL OR collection_method IS NOT NULL
  )
);

CREATE INDEX idx_pickups_shop_status    ON autoprint_v3.pickups(shop_id, status);
CREATE INDEX idx_pickups_hold_expiry    ON autoprint_v3.pickups(hold_until)
  WHERE status = 'ready_for_pickup';
CREATE INDEX idx_pickups_customer       ON autoprint_v3.pickups(customer_id)
  WHERE customer_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. PICKUP RATE-LIMIT STORE
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE autoprint_v3.pickup_attempts (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pickup_id         uuid        NOT NULL REFERENCES autoprint_v3.pickups(id) ON DELETE CASCADE,
  shop_id           uuid        NOT NULL REFERENCES public.shops(id),
  -- SHA-256 of (shop_session_id + ":" + client_ip) — never plaintext
  actor_bucket_hash text        NOT NULL,
  window_start      timestamptz NOT NULL DEFAULT date_trunc('minute', now()),
  attempt_count     integer     NOT NULL DEFAULT 1,
  locked_until      timestamptz,
  last_outcome      text        CHECK (last_outcome IN ('success','failure','rate_limited')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pickup_attempts_window_unique UNIQUE (pickup_id, actor_bucket_hash, window_start)
);

CREATE INDEX idx_pickup_attempts_lookup
  ON autoprint_v3.pickup_attempts(pickup_id, actor_bucket_hash, window_start DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. NOTIFICATION OUTBOX
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE autoprint_v3.notification_outbox (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pickup_id           uuid        NOT NULL REFERENCES autoprint_v3.pickups(id) ON DELETE CASCADE,
  order_id            uuid        NOT NULL REFERENCES autoprint_v3.orders(id),
  customer_id         uuid        REFERENCES autoprint_v3.customers(id),
  shop_id             uuid        NOT NULL REFERENCES public.shops(id),
  event_type          text        NOT NULL
    CHECK (event_type IN ('pickup.ready','pickup.reminder','pickup.hold_expired','pickup.collected','pickup.no_show','pickup.voided')),
  -- Safe payload: no filename, code, document content or signed URL
  safe_payload_json   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  delivery_channel    text        NOT NULL DEFAULT 'in_app'
    CHECK (delivery_channel IN ('in_app','email')),
  delivery_state      text        NOT NULL DEFAULT 'pending'
    CHECK (delivery_state IN ('pending','sent','failed','skipped')),
  attempt_count       integer     NOT NULL DEFAULT 0,
  next_attempt_at     timestamptz NOT NULL DEFAULT now(),
  sent_at             timestamptz,
  failed_at           timestamptz,
  -- Deduplication key prevents double-emit
  dedup_key           text        NOT NULL UNIQUE,  -- pickup_id:event_type:channel
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_outbox_pending
  ON autoprint_v3.notification_outbox(next_attempt_at)
  WHERE delivery_state = 'pending';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. SHOP–CUSTOMER TRUST (local, auditable, reversible)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE autoprint_v3.shop_customer_trust (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id                     uuid        NOT NULL REFERENCES public.shops(id),
  customer_id                 uuid        NOT NULL REFERENCES autoprint_v3.customers(id),
  unpaid_preprint_status      text        NOT NULL DEFAULT 'standard'
    CHECK (unpaid_preprint_status IN ('standard','trusted','restricted')),
  verified_collections        integer     NOT NULL DEFAULT 0 CHECK (verified_collections >= 0),
  verified_no_shows           integer     NOT NULL DEFAULT 0 CHECK (verified_no_shows >= 0),
  restriction_reason          text,
  restriction_source_pickup_id uuid       REFERENCES autoprint_v3.pickups(id),
  restricted_at               timestamptz,
  restricted_by_user_id       uuid        REFERENCES autoprint_v3.users(id),
  version                     integer     NOT NULL DEFAULT 1,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trust_unique UNIQUE (shop_id, customer_id),
  CONSTRAINT trust_restricted_has_reason CHECK (
    unpaid_preprint_status != 'restricted' OR restriction_reason IS NOT NULL
  )
);

CREATE INDEX idx_trust_shop_customer
  ON autoprint_v3.shop_customer_trust(shop_id, customer_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. RLS POLICIES
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE autoprint_v3.shop_pickup_policies  ENABLE ROW LEVEL SECURITY;
ALTER TABLE autoprint_v3.pickups               ENABLE ROW LEVEL SECURITY;
ALTER TABLE autoprint_v3.pickup_attempts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE autoprint_v3.notification_outbox   ENABLE ROW LEVEL SECURITY;
ALTER TABLE autoprint_v3.shop_customer_trust   ENABLE ROW LEVEL SECURITY;

CREATE POLICY api_rls_pickup_policies ON autoprint_v3.shop_pickup_policies
  FOR ALL TO autoprint_api_role USING (true) WITH CHECK (true);
CREATE POLICY svc_rls_pickup_policies ON autoprint_v3.shop_pickup_policies
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY api_rls_pickups ON autoprint_v3.pickups
  FOR ALL TO autoprint_api_role USING (true) WITH CHECK (true);
CREATE POLICY svc_rls_pickups ON autoprint_v3.pickups
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY api_rls_pickup_attempts ON autoprint_v3.pickup_attempts
  FOR ALL TO autoprint_api_role USING (true) WITH CHECK (true);
CREATE POLICY svc_rls_pickup_attempts ON autoprint_v3.pickup_attempts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY api_rls_notification_outbox ON autoprint_v3.notification_outbox
  FOR ALL TO autoprint_api_role USING (true) WITH CHECK (true);
CREATE POLICY svc_rls_notification_outbox ON autoprint_v3.notification_outbox
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY api_rls_shop_customer_trust ON autoprint_v3.shop_customer_trust
  FOR ALL TO autoprint_api_role USING (true) WITH CHECK (true);
CREATE POLICY svc_rls_shop_customer_trust ON autoprint_v3.shop_customer_trust
  FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT SELECT,INSERT,UPDATE ON
  autoprint_v3.shop_pickup_policies,
  autoprint_v3.pickups,
  autoprint_v3.pickup_attempts,
  autoprint_v3.notification_outbox,
  autoprint_v3.shop_customer_trust
TO autoprint_api_role;

GRANT ALL ON
  autoprint_v3.shop_pickup_policies,
  autoprint_v3.pickups,
  autoprint_v3.pickup_attempts,
  autoprint_v3.notification_outbox,
  autoprint_v3.shop_customer_trust
TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. RPC: create_or_ready_pickup_after_confirmed_print
--    Called from Python route after report_print_outcome / resolve_uncertain
--    returns completed. Idempotent: repeated calls produce one pickup row
--    and at most one pickup.ready outbox event.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION autoprint_v3.create_or_ready_pickup_after_confirmed_print(
  p_job_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = autoprint_v3, public, extensions, pg_temp
AS $$
DECLARE
  v_job        autoprint_v3.print_jobs%ROWTYPE;
  v_order      autoprint_v3.orders%ROWTYPE;
  v_policy     autoprint_v3.shop_pickup_policies%ROWTYPE;
  v_pickup     autoprint_v3.pickups%ROWTYPE;
  v_hold_min   integer;
  v_ready_at   timestamptz;
  v_hold_until timestamptz;
  v_snap       jsonb;
  v_dedup_key  text;
BEGIN
  -- Lock job and order to prevent concurrent double-creation
  SELECT * INTO v_job FROM autoprint_v3.print_jobs WHERE id = p_job_id FOR UPDATE;
  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'Job not found: %', p_job_id USING ERRCODE = 'P0050';
  END IF;

  -- Only act on confirmed completion
  IF v_job.status != 'completed' THEN
    RETURN jsonb_build_object('result', 'skipped', 'reason', 'job_not_completed');
  END IF;

  SELECT * INTO v_order FROM autoprint_v3.orders WHERE id = v_job.order_id;

  -- Only create pickups for remote orders
  IF v_order.fulfillment_mode != 'remote' THEN
    RETURN jsonb_build_object('result', 'skipped', 'reason', 'counter_order');
  END IF;

  -- Check feature flag
  SELECT * INTO v_policy
    FROM autoprint_v3.shop_pickup_policies
    WHERE shop_id = v_job.shop_id;

  IF v_policy.shop_id IS NULL OR NOT v_policy.pickup_workflow_enabled THEN
    RETURN jsonb_build_object('result', 'skipped', 'reason', 'pickup_workflow_disabled');
  END IF;

  -- Idempotency: return existing pickup if already created
  SELECT * INTO v_pickup FROM autoprint_v3.pickups WHERE job_id = p_job_id;
  IF v_pickup.id IS NOT NULL THEN
    IF v_pickup.status IN ('ready_for_pickup', 'collected', 'hold_expired', 'no_show', 'voided') THEN
      RETURN jsonb_build_object('result', 'already_ready', 'pickup_id', v_pickup.id, 'status', v_pickup.status);
    END IF;
  END IF;

  -- Snapshot effective policy values
  v_hold_min   := v_policy.hold_period_minutes;
  v_ready_at   := now();
  v_hold_until := now() + (v_hold_min || ' minutes')::interval;
  v_snap := jsonb_build_object(
    'pickup_workflow_enabled',           v_policy.pickup_workflow_enabled,
    'hold_period_minutes',               v_hold_min,
    'no_show_disables_unpaid_preprint',  v_policy.no_show_disables_unpaid_preprint,
    'policy_version',                    v_policy.policy_version,
    'captured_at',                       now()
  );

  IF v_pickup.id IS NULL THEN
    -- Create new pickup in ready_for_pickup state
    INSERT INTO autoprint_v3.pickups (
      order_id, job_id, shop_id, customer_id, status,
      policy_snapshot_json, policy_version,
      code_key_version,
      ready_at, hold_until
    ) VALUES (
      v_order.id, p_job_id, v_job.shop_id, v_order.customer_id, 'ready_for_pickup',
      v_snap, v_policy.policy_version,
      1,
      v_ready_at, v_hold_until
    ) RETURNING * INTO v_pickup;
  ELSE
    -- Transition awaiting_print → ready_for_pickup
    UPDATE autoprint_v3.pickups
    SET status               = 'ready_for_pickup',
        policy_snapshot_json = v_snap,
        policy_version       = v_policy.policy_version,
        ready_at             = v_ready_at,
        hold_until           = v_hold_until,
        version              = version + 1,
        updated_at           = now()
    WHERE id = v_pickup.id
    RETURNING * INTO v_pickup;
  END IF;

  -- Emit pickup.ready outbox event (idempotent via dedup_key)
  v_dedup_key := v_pickup.id::text || ':pickup.ready:in_app';
  INSERT INTO autoprint_v3.notification_outbox (
    pickup_id, order_id, customer_id, shop_id,
    event_type, safe_payload_json, delivery_channel, dedup_key
  ) VALUES (
    v_pickup.id, v_order.id, v_order.customer_id, v_job.shop_id,
    'pickup.ready',
    jsonb_build_object('status', 'ready_for_pickup', 'hold_until', v_hold_until),
    'in_app',
    v_dedup_key
  ) ON CONFLICT (dedup_key) DO NOTHING;

  -- Audit event
  INSERT INTO autoprint_v3.audit_events (
    shop_id, actor_type, actor_id, event_type, target_type, target_id, metadata_json
  ) VALUES (
    v_job.shop_id, 'system', NULL, 'PICKUP_CREATED_READY', 'pickups', v_pickup.id,
    jsonb_build_object('job_id', p_job_id, 'hold_until', v_hold_until)
  );

  RETURN jsonb_build_object('result', 'ready', 'pickup_id', v_pickup.id, 'hold_until', v_hold_until);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. RPC: redeem_pickup_code
--    Called from shop collect route. Locks pickup, compares code hash,
--    sets collected atomically, and updates local trust.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION autoprint_v3.redeem_pickup_code(
  p_pickup_id         uuid,
  p_shop_id           uuid,
  p_code_hash         text,   -- SHA-256(code.upper() + ":" + pickup_id::text)
  p_user_id           uuid,
  p_collection_method text DEFAULT 'code'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = autoprint_v3, public, extensions, pg_temp
AS $$
DECLARE
  v_pickup autoprint_v3.pickups%ROWTYPE;
BEGIN
  SELECT * INTO v_pickup FROM autoprint_v3.pickups WHERE id = p_pickup_id FOR UPDATE;

  IF v_pickup.id IS NULL OR v_pickup.shop_id != p_shop_id THEN
    RETURN jsonb_build_object('result', 'invalid');
  END IF;

  -- Only redeemable in ready_for_pickup or hold_expired
  IF v_pickup.status NOT IN ('ready_for_pickup', 'hold_expired') THEN
    IF v_pickup.status = 'collected' THEN
      RETURN jsonb_build_object('result', 'already_collected', 'pickup_id', p_pickup_id);
    END IF;
    RETURN jsonb_build_object('result', 'invalid');
  END IF;

  -- Constant-time hash comparison (p_code_hash derived and supplied by server)
  IF v_pickup.code_hash IS NULL OR v_pickup.code_hash != p_code_hash THEN
    RETURN jsonb_build_object('result', 'invalid');
  END IF;

  -- Collect
  UPDATE autoprint_v3.pickups
  SET status               = 'collected',
      collected_at         = now(),
      collected_by_user_id = p_user_id,
      collection_method    = p_collection_method,
      version              = version + 1,
      updated_at           = now()
  WHERE id = p_pickup_id;

  -- Update shop–customer trust projection
  IF v_pickup.customer_id IS NOT NULL THEN
    INSERT INTO autoprint_v3.shop_customer_trust (shop_id, customer_id, verified_collections)
    VALUES (p_shop_id, v_pickup.customer_id, 1)
    ON CONFLICT (shop_id, customer_id) DO UPDATE
      SET verified_collections = autoprint_v3.shop_customer_trust.verified_collections + 1,
          version              = autoprint_v3.shop_customer_trust.version + 1,
          updated_at           = now();
  END IF;

  -- Outbox: pickup.collected
  INSERT INTO autoprint_v3.notification_outbox (
    pickup_id, order_id, customer_id, shop_id,
    event_type, safe_payload_json, delivery_channel, dedup_key
  ) VALUES (
    p_pickup_id, v_pickup.order_id, v_pickup.customer_id, p_shop_id,
    'pickup.collected',
    jsonb_build_object('collected_at', now()),
    'in_app',
    p_pickup_id::text || ':pickup.collected:in_app'
  ) ON CONFLICT (dedup_key) DO NOTHING;

  -- Audit
  INSERT INTO autoprint_v3.audit_events (
    shop_id, actor_type, actor_id, event_type, target_type, target_id, metadata_json
  ) VALUES (
    p_shop_id, 'shop_user', p_user_id, 'PICKUP_COLLECTED', 'pickups', p_pickup_id,
    jsonb_build_object('method', p_collection_method)
  );

  RETURN jsonb_build_object('result', 'collected', 'pickup_id', p_pickup_id);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. RPC: manual_collect_pickup
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION autoprint_v3.manual_collect_pickup(
  p_pickup_id            uuid,
  p_shop_id              uuid,
  p_user_id              uuid,
  p_reason               text,
  p_idempotency_key_hash text,
  p_request_hash         text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = autoprint_v3, public, extensions, pg_temp
AS $$
DECLARE
  v_pickup  autoprint_v3.pickups%ROWTYPE;
  v_cached  autoprint_v3.idempotency_keys%ROWTYPE;
  v_scope   text := 'manual_collect:' || p_pickup_id::text;
  v_result  jsonb;
BEGIN
  -- Idempotency check
  SELECT * INTO v_cached FROM autoprint_v3.idempotency_keys
    WHERE scope = v_scope AND key_hash = p_idempotency_key_hash;
  IF v_cached.id IS NOT NULL THEN
    IF v_cached.request_hash != p_request_hash THEN
      RAISE EXCEPTION 'Idempotency key reused' USING ERRCODE = 'P0040';
    END IF;
    RETURN v_cached.response_json;
  END IF;

  -- Reason validation
  IF p_reason IS NULL OR length(trim(p_reason)) < 10 OR length(trim(p_reason)) > 500 THEN
    RAISE EXCEPTION 'Reason must be 10–500 characters' USING ERRCODE = 'P0051';
  END IF;

  -- Membership check
  IF NOT EXISTS (
    SELECT 1 FROM autoprint_v3.shop_memberships
    WHERE shop_id = p_shop_id AND user_id = p_user_id
      AND active AND role IN ('owner','staff')
  ) THEN
    RAISE EXCEPTION 'User cannot manually collect for this shop' USING ERRCODE = 'P0052';
  END IF;

  SELECT * INTO v_pickup FROM autoprint_v3.pickups WHERE id = p_pickup_id FOR UPDATE;

  IF v_pickup.id IS NULL OR v_pickup.shop_id != p_shop_id THEN
    RAISE EXCEPTION 'Pickup not found' USING ERRCODE = 'P0053';
  END IF;

  IF v_pickup.status NOT IN ('ready_for_pickup', 'hold_expired') THEN
    IF v_pickup.status = 'collected' THEN
      v_result := jsonb_build_object('result', 'already_collected');
      INSERT INTO autoprint_v3.idempotency_keys (scope,key_hash,request_hash,response_status,response_json,expires_at)
        VALUES (v_scope,p_idempotency_key_hash,p_request_hash,200,v_result,now()+interval '24 hours')
        ON CONFLICT (scope,key_hash) DO NOTHING;
      RETURN v_result;
    END IF;
    RAISE EXCEPTION 'Pickup cannot be manually collected in status %', v_pickup.status USING ERRCODE = 'P0054';
  END IF;

  UPDATE autoprint_v3.pickups
  SET status               = 'collected',
      collected_at         = now(),
      collected_by_user_id = p_user_id,
      collection_method    = 'manual_override',
      version              = version + 1,
      updated_at           = now()
  WHERE id = p_pickup_id;

  INSERT INTO autoprint_v3.audit_events (
    shop_id, actor_type, actor_id, event_type, target_type, target_id, metadata_json
  ) VALUES (
    p_shop_id, 'shop_user', p_user_id, 'PICKUP_MANUAL_COLLECTED', 'pickups', p_pickup_id,
    jsonb_build_object('reason', left(trim(p_reason), 500))
  );

  v_result := jsonb_build_object('result', 'collected', 'pickup_id', p_pickup_id, 'method', 'manual_override');
  INSERT INTO autoprint_v3.idempotency_keys (scope,key_hash,request_hash,response_status,response_json,expires_at)
    VALUES (v_scope,p_idempotency_key_hash,p_request_hash,200,v_result,now()+interval '24 hours')
    ON CONFLICT (scope,key_hash) DO NOTHING;

  RETURN v_result;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. RPC: expire_due_pickups
--     Safe for concurrent workers via SKIP LOCKED. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION autoprint_v3.expire_due_pickups()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = autoprint_v3, public, extensions, pg_temp
AS $$
DECLARE
  v_row    record;
  v_count  integer := 0;
  v_dedup  text;
BEGIN
  FOR v_row IN
    SELECT id, order_id, customer_id, shop_id
    FROM autoprint_v3.pickups
    WHERE status = 'ready_for_pickup'
      AND hold_until <= now()
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE autoprint_v3.pickups
    SET status          = 'hold_expired',
        hold_expired_at = now(),
        version         = version + 1,
        updated_at      = now()
    WHERE id = v_row.id;

    v_dedup := v_row.id::text || ':pickup.hold_expired:in_app';
    INSERT INTO autoprint_v3.notification_outbox (
      pickup_id, order_id, customer_id, shop_id,
      event_type, safe_payload_json, delivery_channel, dedup_key
    ) VALUES (
      v_row.id, v_row.order_id, v_row.customer_id, v_row.shop_id,
      'pickup.hold_expired',
      jsonb_build_object('expired_at', now()),
      'in_app',
      v_dedup
    ) ON CONFLICT (dedup_key) DO NOTHING;

    INSERT INTO autoprint_v3.audit_events (
      shop_id, actor_type, actor_id, event_type, target_type, target_id
    ) VALUES (
      v_row.shop_id, 'system', NULL, 'PICKUP_HOLD_EXPIRED', 'pickups', v_row.id
    );

    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. RPC: mark_pickup_no_show
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION autoprint_v3.mark_pickup_no_show(
  p_pickup_id  uuid,
  p_shop_id    uuid,
  p_user_id    uuid,
  p_reason     text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = autoprint_v3, public, extensions, pg_temp
AS $$
DECLARE
  v_pickup autoprint_v3.pickups%ROWTYPE;
  v_policy autoprint_v3.shop_pickup_policies%ROWTYPE;
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) < 10 OR length(trim(p_reason)) > 500 THEN
    RAISE EXCEPTION 'No-show reason must be 10–500 characters' USING ERRCODE = 'P0055';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM autoprint_v3.shop_memberships
    WHERE shop_id = p_shop_id AND user_id = p_user_id
      AND active AND role IN ('owner','staff')
  ) THEN
    RAISE EXCEPTION 'User cannot mark no-show for this shop' USING ERRCODE = 'P0056';
  END IF;

  SELECT * INTO v_pickup FROM autoprint_v3.pickups WHERE id = p_pickup_id FOR UPDATE;

  IF v_pickup.id IS NULL OR v_pickup.shop_id != p_shop_id THEN
    RAISE EXCEPTION 'Pickup not found' USING ERRCODE = 'P0057';
  END IF;

  -- Must be hold_expired
  IF v_pickup.status != 'hold_expired' THEN
    IF v_pickup.status = 'no_show' THEN
      RETURN jsonb_build_object('result', 'already_no_show', 'pickup_id', p_pickup_id);
    END IF;
    IF v_pickup.status = 'ready_for_pickup' THEN
      RAISE EXCEPTION 'Cannot mark no-show before hold period expires' USING ERRCODE = 'P0058';
    END IF;
    RAISE EXCEPTION 'Pickup is not in hold_expired state' USING ERRCODE = 'P0059';
  END IF;

  -- Extra safety: hold_until must be in the past (database time)
  IF v_pickup.hold_until > now() THEN
    RAISE EXCEPTION 'Hold period has not yet expired' USING ERRCODE = 'P0060';
  END IF;

  UPDATE autoprint_v3.pickups
  SET status               = 'no_show',
      no_show_at           = now(),
      no_show_by_user_id   = p_user_id,
      no_show_reason       = left(trim(p_reason), 500),
      version              = version + 1,
      updated_at           = now()
  WHERE id = p_pickup_id;

  -- Update shop–customer trust if policy requires it
  SELECT * INTO v_policy FROM autoprint_v3.shop_pickup_policies WHERE shop_id = p_shop_id;
  IF v_pickup.customer_id IS NOT NULL AND v_policy.no_show_disables_unpaid_preprint THEN
    INSERT INTO autoprint_v3.shop_customer_trust (
      shop_id, customer_id, verified_no_shows,
      unpaid_preprint_status, restriction_reason,
      restriction_source_pickup_id, restricted_at, restricted_by_user_id
    ) VALUES (
      p_shop_id, v_pickup.customer_id, 1,
      'restricted', left(trim(p_reason), 500),
      p_pickup_id, now(), p_user_id
    )
    ON CONFLICT (shop_id, customer_id) DO UPDATE
      SET verified_no_shows          = autoprint_v3.shop_customer_trust.verified_no_shows + 1,
          unpaid_preprint_status     = 'restricted',
          restriction_reason         = left(trim(p_reason), 500),
          restriction_source_pickup_id = p_pickup_id,
          restricted_at              = now(),
          restricted_by_user_id      = p_user_id,
          version                    = autoprint_v3.shop_customer_trust.version + 1,
          updated_at                 = now();
  ELSIF v_pickup.customer_id IS NOT NULL THEN
    INSERT INTO autoprint_v3.shop_customer_trust (shop_id, customer_id, verified_no_shows)
    VALUES (p_shop_id, v_pickup.customer_id, 1)
    ON CONFLICT (shop_id, customer_id) DO UPDATE
      SET verified_no_shows = autoprint_v3.shop_customer_trust.verified_no_shows + 1,
          version           = autoprint_v3.shop_customer_trust.version + 1,
          updated_at        = now();
  END IF;

  INSERT INTO autoprint_v3.audit_events (
    shop_id, actor_type, actor_id, event_type, target_type, target_id, metadata_json
  ) VALUES (
    p_shop_id, 'shop_user', p_user_id, 'PICKUP_NO_SHOW', 'pickups', p_pickup_id,
    jsonb_build_object('reason', left(trim(p_reason), 500), 'trust_restricted', v_policy.no_show_disables_unpaid_preprint)
  );

  RETURN jsonb_build_object(
    'result', 'no_show', 'pickup_id', p_pickup_id,
    'trust_restricted', (v_pickup.customer_id IS NOT NULL AND v_policy.no_show_disables_unpaid_preprint)
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. RPC: void_pickup_for_terminal_order
--     Called when order is cancelled/rejected/failed before pickup readiness.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION autoprint_v3.void_pickup_for_terminal_order(
  p_job_id    uuid,
  p_reason    text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = autoprint_v3, public, extensions, pg_temp
AS $$
DECLARE
  v_pickup autoprint_v3.pickups%ROWTYPE;
BEGIN
  SELECT * INTO v_pickup FROM autoprint_v3.pickups WHERE job_id = p_job_id FOR UPDATE;
  IF v_pickup.id IS NULL THEN
    RETURN false;  -- No pickup to void
  END IF;
  IF v_pickup.status NOT IN ('awaiting_print') THEN
    -- Never silently change a collected/ready pickup
    RETURN false;
  END IF;
  UPDATE autoprint_v3.pickups
  SET status      = 'voided',
      voided_at   = now(),
      void_reason = left(COALESCE(p_reason,'terminal_order'), 500),
      version     = version + 1,
      updated_at  = now()
  WHERE id = v_pickup.id;

  INSERT INTO autoprint_v3.audit_events (
    shop_id, actor_type, actor_id, event_type, target_type, target_id, metadata_json
  ) VALUES (
    v_pickup.shop_id, 'system', NULL, 'PICKUP_VOIDED', 'pickups', v_pickup.id,
    jsonb_build_object('reason', left(COALESCE(p_reason,'terminal_order'), 500))
  );
  RETURN true;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. RPC: set_pickup_policy
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION autoprint_v3.set_pickup_policy(
  p_shop_id                        uuid,
  p_user_id                        uuid,
  p_enabled                        boolean,
  p_hold_period_minutes            integer,
  p_reminder_offsets_minutes       jsonb,
  p_no_show_disables_unpaid_preprint boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = autoprint_v3, public, extensions, pg_temp
AS $$
DECLARE
  v_policy autoprint_v3.shop_pickup_policies%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM autoprint_v3.shop_memberships
    WHERE shop_id = p_shop_id AND user_id = p_user_id
      AND active AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Only shop owners can update pickup policy' USING ERRCODE = 'P0061';
  END IF;

  IF p_hold_period_minutes < 720 OR p_hold_period_minutes > 20160 THEN
    RAISE EXCEPTION 'hold_period_minutes must be between 720 (12 h) and 20160 (14 days)' USING ERRCODE = 'P0062';
  END IF;

  INSERT INTO autoprint_v3.shop_pickup_policies (
    shop_id, pickup_workflow_enabled, hold_period_minutes,
    reminder_offsets_minutes, no_show_disables_unpaid_preprint, updated_by_user_id
  ) VALUES (
    p_shop_id, p_enabled, p_hold_period_minutes,
    p_reminder_offsets_minutes, p_no_show_disables_unpaid_preprint, p_user_id
  )
  ON CONFLICT (shop_id) DO UPDATE
    SET pickup_workflow_enabled          = EXCLUDED.pickup_workflow_enabled,
        hold_period_minutes              = EXCLUDED.hold_period_minutes,
        reminder_offsets_minutes         = EXCLUDED.reminder_offsets_minutes,
        no_show_disables_unpaid_preprint = EXCLUDED.no_show_disables_unpaid_preprint,
        policy_version                   = autoprint_v3.shop_pickup_policies.policy_version + 1,
        updated_by_user_id               = EXCLUDED.updated_by_user_id,
        updated_at                       = now()
  RETURNING * INTO v_policy;

  INSERT INTO autoprint_v3.audit_events (
    shop_id, actor_type, actor_id, event_type, target_type, target_id, metadata_json
  ) VALUES (
    p_shop_id, 'shop_user', p_user_id, 'PICKUP_POLICY_UPDATED', 'shop_pickup_policies', p_shop_id,
    jsonb_build_object(
      'enabled', p_enabled,
      'hold_period_minutes', p_hold_period_minutes,
      'version', v_policy.policy_version
    )
  );

  RETURN to_jsonb(v_policy);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 14. RPC: restore_customer_trust
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION autoprint_v3.restore_customer_trust(
  p_shop_id     uuid,
  p_user_id     uuid,
  p_customer_id uuid,
  p_reason      text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = autoprint_v3, public, extensions, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM autoprint_v3.shop_memberships
    WHERE shop_id = p_shop_id AND user_id = p_user_id
      AND active AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Only shop owners can restore customer trust' USING ERRCODE = 'P0063';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'Restoration reason required (min 10 chars)' USING ERRCODE = 'P0064';
  END IF;

  UPDATE autoprint_v3.shop_customer_trust
  SET unpaid_preprint_status    = 'standard',
      restriction_reason        = NULL,
      restriction_source_pickup_id = NULL,
      restricted_at             = NULL,
      restricted_by_user_id     = NULL,
      version                   = version + 1,
      updated_at                = now()
  WHERE shop_id = p_shop_id AND customer_id = p_customer_id;

  INSERT INTO autoprint_v3.audit_events (
    shop_id, actor_type, actor_id, event_type, target_type, target_id, metadata_json
  ) VALUES (
    p_shop_id, 'shop_user', p_user_id, 'CUSTOMER_TRUST_RESTORED', 'shop_customer_trust', p_customer_id,
    jsonb_build_object('reason', left(trim(p_reason), 500))
  );

  RETURN true;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 15. GRANTS FOR NEW RPCs
-- ─────────────────────────────────────────────────────────────────────────────
GRANT EXECUTE ON
  FUNCTION autoprint_v3.create_or_ready_pickup_after_confirmed_print(uuid),
  autoprint_v3.redeem_pickup_code(uuid, uuid, text, uuid, text),
  autoprint_v3.manual_collect_pickup(uuid, uuid, uuid, text, text, text),
  autoprint_v3.expire_due_pickups(),
  autoprint_v3.mark_pickup_no_show(uuid, uuid, uuid, text),
  autoprint_v3.void_pickup_for_terminal_order(uuid, text),
  autoprint_v3.set_pickup_policy(uuid, uuid, boolean, integer, jsonb, boolean),
  autoprint_v3.restore_customer_trust(uuid, uuid, uuid, text)
TO autoprint_api_role, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
