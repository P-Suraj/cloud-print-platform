-- Phase 5: Queue workload and readiness estimates
-- This migration defaults every new lane to unavailable until the connected
-- Windows agent has sent a fresh heartbeat. Estimates are advisory, not SLAs.

BEGIN;

CREATE TABLE autoprint_v3.shop_printer_lanes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    lane_type text NOT NULL CHECK (lane_type IN ('bw', 'colour')),
    device_id uuid REFERENCES autoprint_v3.devices(id) ON DELETE SET NULL,
    -- Shared keys represent one physical printer; different keys are independent.
    physical_device_key text NOT NULL DEFAULT 'shared-default' CHECK (length(trim(physical_device_key)) BETWEEN 1 AND 80),
    ppm_simplex numeric(5,1) NOT NULL CHECK (ppm_simplex > 0),
    ppm_duplex numeric(5,1) NOT NULL CHECK (ppm_duplex > 0),
    job_setup_overhead_sec integer NOT NULL DEFAULT 15 CHECK (job_setup_overhead_sec BETWEEN 0 AND 600),
    enabled boolean NOT NULL DEFAULT true,
    algorithm_version integer NOT NULL DEFAULT 1,
    updated_by_user_id uuid REFERENCES autoprint_v3.users(id) ON DELETE SET NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(shop_id, lane_type)
);

CREATE INDEX shop_printer_lanes_shop_device_idx ON autoprint_v3.shop_printer_lanes(shop_id, device_id);

-- Walk-in work is lane-specific and automatically expires.
CREATE TABLE autoprint_v3.shop_walkin_backlogs (
    shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    lane_type text NOT NULL CHECK (lane_type IN ('bw', 'colour')),
    backlog_minutes integer NOT NULL CHECK (backlog_minutes BETWEEN 0 AND 120),
    expires_at timestamptz NOT NULL,
    set_by_user_id uuid REFERENCES autoprint_v3.users(id) ON DELETE SET NULL,
    reason text,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (shop_id, lane_type),
    CHECK (expires_at <= updated_at + interval '8 hours')
);

CREATE INDEX shop_walkin_backlogs_active_idx ON autoprint_v3.shop_walkin_backlogs(shop_id, lane_type, expires_at);

-- Immutable prediction records are later paired with real completion times.
CREATE TABLE autoprint_v3.queue_estimate_calibration_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id uuid NOT NULL UNIQUE REFERENCES autoprint_v3.print_jobs(id) ON DELETE CASCADE,
    shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    lane_type text NOT NULL CHECK (lane_type IN ('bw', 'colour')),
    algorithm_version integer NOT NULL,
    queue_workload_seconds integer NOT NULL CHECK (queue_workload_seconds >= 0),
    job_workload_seconds integer NOT NULL CHECK (job_workload_seconds >= 0),
    estimated_seconds_min integer NOT NULL CHECK (estimated_seconds_min >= 0),
    estimated_seconds_max integer NOT NULL CHECK (estimated_seconds_max >= estimated_seconds_min),
    confidence text NOT NULL CHECK (confidence IN ('high', 'medium', 'unavailable')),
    agent_freshness_seconds numeric,
    created_at timestamptz NOT NULL DEFAULT now(),
    actual_ready_seconds integer CHECK (actual_ready_seconds >= 0),
    completed_at timestamptz
);

CREATE INDEX queue_estimate_calibration_shop_lane_idx ON autoprint_v3.queue_estimate_calibration_logs(shop_id, lane_type, created_at DESC);

-- The API uses the service role; customers have no direct table access.
ALTER TABLE autoprint_v3.shop_printer_lanes ENABLE ROW LEVEL SECURITY;
ALTER TABLE autoprint_v3.shop_walkin_backlogs ENABLE ROW LEVEL SECURITY;
ALTER TABLE autoprint_v3.queue_estimate_calibration_logs ENABLE ROW LEVEL SECURITY;

-- The eligible waiting set exactly mirrors claim_next_print_job: approved,
-- unclaimed work that is counter eligible, risk accepted, or checked in.
CREATE OR REPLACE FUNCTION autoprint_v3.calculate_queue_estimate(
    p_shop_id uuid,
    p_lane_type text,
    p_job_pages integer DEFAULT 0,
    p_job_copies integer DEFAULT 1,
    p_job_is_duplex boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = autoprint_v3, public, extensions, pg_temp
AS $$
DECLARE
    v_lane autoprint_v3.shop_printer_lanes%ROWTYPE;
    v_last_seen timestamptz;
    v_freshness numeric;
    v_queue_seconds integer := 0;
    v_queue_depth integer := 0;
    v_walkin_seconds integer := 0;
    v_job_seconds integer := 0;
    v_min_seconds integer := 0;
    v_max_seconds integer := 0;
    v_confidence text := 'unavailable';
    v_ppm numeric;
BEGIN
    IF p_lane_type NOT IN ('bw', 'colour') OR p_job_pages < 0 OR p_job_copies < 1 THEN
        RETURN jsonb_build_object('error', 'invalid_request');
    END IF;

    SELECT * INTO v_lane FROM autoprint_v3.shop_printer_lanes
    WHERE shop_id = p_shop_id AND lane_type = p_lane_type;

    -- Missing configuration is unknown, not a fictional online printer.
    IF NOT FOUND OR NOT v_lane.enabled THEN
        RETURN jsonb_build_object('estimated_min', 0, 'estimated_max', 0, 'confidence', 'unavailable',
            'queue_depth', 0, 'agent_freshness_seconds', -1);
    END IF;

    SELECT max(d.last_seen_at) INTO v_last_seen FROM autoprint_v3.devices d
    WHERE d.shop_id = p_shop_id AND d.status = 'active'
      AND (v_lane.device_id IS NULL OR d.id = v_lane.device_id);

    v_freshness := CASE WHEN v_last_seen IS NULL THEN -1 ELSE GREATEST(0, extract(epoch FROM now() - v_last_seen)) END;
    IF v_freshness < 0 OR v_freshness > 90 THEN
        RETURN jsonb_build_object('estimated_min', 0, 'estimated_max', 0, 'confidence', 'unavailable',
            'queue_depth', 0, 'agent_freshness_seconds', v_freshness);
    END IF;
    v_confidence := CASE WHEN v_freshness <= 30 THEN 'high' ELSE 'medium' END;

    SELECT
        COALESCE(SUM(
            CEIL((COALESCE((q.breakdown_json->>'selected_page_count')::integer, a.logical_page_count)
                * COALESCE((q.breakdown_json->>'copies')::integer, (q.options_json->>'copies')::integer, 1))
                / NULLIF(CASE WHEN COALESCE((q.options_json->>'duplex')::boolean, false)
                    THEN v_lane.ppm_duplex ELSE v_lane.ppm_simplex END, 0) * 60)
            + v_lane.job_setup_overhead_sec
        ), 0)::integer,
        COUNT(*)::integer
    INTO v_queue_seconds, v_queue_depth
    FROM autoprint_v3.print_jobs j
    JOIN autoprint_v3.orders o ON o.id = j.order_id
    JOIN autoprint_v3.print_artifacts a ON a.id = j.artifact_id
    JOIN autoprint_v3.price_quotes q ON q.id = j.quote_id
    LEFT JOIN autoprint_v3.shop_printer_lanes job_lane
      ON job_lane.shop_id = j.shop_id
      AND job_lane.lane_type = CASE WHEN COALESCE((q.options_json->>'colour')::boolean, false) THEN 'colour' ELSE 'bw' END
    WHERE j.shop_id = p_shop_id
      AND j.status = 'waiting_for_shop'
      AND j.approved_at IS NOT NULL
      AND j.current_attempt_id IS NULL
      AND (j.print_eligibility IN ('counter', 'shop_risk_accepted') OR o.customer_checked_in_at IS NOT NULL)
      AND (
        CASE WHEN COALESCE((q.options_json->>'colour')::boolean, false) THEN 'colour' ELSE 'bw' END = p_lane_type
        OR (job_lane.id IS NOT NULL AND job_lane.physical_device_key = v_lane.physical_device_key)
      );

    SELECT COALESCE(backlog_minutes, 0) * 60 INTO v_walkin_seconds
    FROM autoprint_v3.shop_walkin_backlogs
    WHERE shop_id = p_shop_id AND lane_type = p_lane_type AND expires_at > now();
    v_walkin_seconds := COALESCE(v_walkin_seconds, 0);

    IF p_job_pages > 0 THEN
        v_ppm := CASE WHEN p_job_is_duplex THEN v_lane.ppm_duplex ELSE v_lane.ppm_simplex END;
        v_job_seconds := CEIL((p_job_pages * p_job_copies) / v_ppm * 60)::integer + v_lane.job_setup_overhead_sec;
    END IF;

    v_min_seconds := v_queue_seconds + v_walkin_seconds + v_job_seconds;
    v_max_seconds := CEIL(v_min_seconds * CASE WHEN v_confidence = 'high' THEN 1.35 ELSE 1.60 END)::integer;
    IF v_min_seconds > 0 AND v_max_seconds <= v_min_seconds THEN v_max_seconds := v_min_seconds + 60; END IF;

    RETURN jsonb_build_object(
        'estimated_min', CEIL(v_min_seconds / 60.0), 'estimated_max', CEIL(v_max_seconds / 60.0),
        'confidence', v_confidence, 'queue_depth', v_queue_depth,
        'queue_workload_seconds', v_queue_seconds + v_walkin_seconds,
        'job_workload_seconds', v_job_seconds, 'algorithm_version', v_lane.algorithm_version,
        'agent_freshness_seconds', v_freshness
    );
END;
$$;

CREATE OR REPLACE FUNCTION autoprint_v3.snapshot_queue_estimate_for_job()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = autoprint_v3, public, extensions, pg_temp
AS $$
DECLARE
    v_quote autoprint_v3.price_quotes%ROWTYPE;
    v_artifact autoprint_v3.print_artifacts%ROWTYPE;
    v_lane text;
    v_result jsonb;
BEGIN
    SELECT * INTO v_quote FROM autoprint_v3.price_quotes WHERE id = NEW.quote_id;
    SELECT * INTO v_artifact FROM autoprint_v3.print_artifacts WHERE id = NEW.artifact_id;
    v_lane := CASE WHEN COALESCE((v_quote.options_json->>'colour')::boolean, false) THEN 'colour' ELSE 'bw' END;
    v_result := autoprint_v3.calculate_queue_estimate(NEW.shop_id, v_lane,
        COALESCE((v_quote.breakdown_json->>'selected_page_count')::integer, v_artifact.logical_page_count),
        COALESCE((v_quote.breakdown_json->>'copies')::integer, (v_quote.options_json->>'copies')::integer, 1),
        COALESCE((v_quote.options_json->>'duplex')::boolean, false));
    INSERT INTO autoprint_v3.queue_estimate_calibration_logs(
        job_id, shop_id, lane_type, algorithm_version, queue_workload_seconds,
        job_workload_seconds, estimated_seconds_min, estimated_seconds_max, confidence, agent_freshness_seconds
    ) VALUES (
        NEW.id, NEW.shop_id, v_lane, COALESCE((v_result->>'algorithm_version')::integer, 1),
        COALESCE((v_result->>'queue_workload_seconds')::integer, 0), COALESCE((v_result->>'job_workload_seconds')::integer, 0),
        COALESCE((v_result->>'estimated_min')::integer, 0) * 60, COALESCE((v_result->>'estimated_max')::integer, 0) * 60,
        COALESCE(v_result->>'confidence', 'unavailable'), NULLIF(v_result->>'agent_freshness_seconds', '')::numeric
    ) ON CONFLICT (job_id) DO NOTHING;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION autoprint_v3.capture_queue_estimate_actual()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = autoprint_v3, public, extensions, pg_temp
AS $$
BEGIN
    IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' AND NEW.completed_at IS NOT NULL THEN
        UPDATE autoprint_v3.queue_estimate_calibration_logs
        SET actual_ready_seconds = GREATEST(0, EXTRACT(epoch FROM NEW.completed_at - created_at)::integer), completed_at = NEW.completed_at
        WHERE job_id = NEW.id AND actual_ready_seconds IS NULL;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_snapshot_queue_estimate_for_job AFTER INSERT ON autoprint_v3.print_jobs
FOR EACH ROW EXECUTE FUNCTION autoprint_v3.snapshot_queue_estimate_for_job();
CREATE TRIGGER trg_capture_queue_estimate_actual AFTER UPDATE OF status, completed_at ON autoprint_v3.print_jobs
FOR EACH ROW EXECUTE FUNCTION autoprint_v3.capture_queue_estimate_actual();

GRANT EXECUTE ON FUNCTION autoprint_v3.calculate_queue_estimate(uuid, text, integer, integer, boolean) TO autoprint_api_role, service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
