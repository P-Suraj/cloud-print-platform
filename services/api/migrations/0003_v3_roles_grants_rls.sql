-- Migration 0003: v3 Roles, Grants, and RLS Policies Schema
-- Target Namespace: autoprint_v3
-- 
-- ADR 0001 compliance: service_role is NOT used for application traffic.
-- Two least-privilege roles are created:
--   autoprint_api_role  — used by the FastAPI backend
--   autoprint_worker_role — used by the preparation and cleanup workers
--
-- service_role retains schema-level access for migration runs ONLY.

BEGIN;

-- 1. Enable Row-Level Security on All v3 Tables
ALTER TABLE autoprint_v3.users                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE autoprint_v3.shop_memberships       ENABLE ROW LEVEL SECURITY;
ALTER TABLE autoprint_v3.user_sessions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE autoprint_v3.devices                ENABLE ROW LEVEL SECURITY;
ALTER TABLE autoprint_v3.device_enrollment_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE autoprint_v3.orders                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE autoprint_v3.source_documents       ENABLE ROW LEVEL SECURITY;
ALTER TABLE autoprint_v3.preparation_tasks      ENABLE ROW LEVEL SECURITY;
ALTER TABLE autoprint_v3.print_artifacts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE autoprint_v3.rate_cards             ENABLE ROW LEVEL SECURITY;
ALTER TABLE autoprint_v3.price_quotes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE autoprint_v3.print_jobs             ENABLE ROW LEVEL SECURITY;
ALTER TABLE autoprint_v3.print_attempts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE autoprint_v3.job_transitions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE autoprint_v3.allowed_job_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE autoprint_v3.audit_events           ENABLE ROW LEVEL SECURITY;
ALTER TABLE autoprint_v3.idempotency_keys       ENABLE ROW LEVEL SECURITY;

-- 2. Revoke direct mutation rights from PostgREST browser roles
REVOKE ALL ON ALL TABLES    IN SCHEMA autoprint_v3 FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA autoprint_v3 FROM anon, authenticated;

-- 3. Create application roles (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autoprint_api_role') THEN
    CREATE ROLE autoprint_api_role NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autoprint_worker_role') THEN
    CREATE ROLE autoprint_worker_role NOLOGIN;
  END IF;
END $$;

-- PostgREST authenticates as authenticator and switches to the JWT role claim.
GRANT autoprint_api_role, autoprint_worker_role TO authenticator;

-- 4. Grant schema usage to application roles and service_role (migration-only)
GRANT USAGE ON SCHEMA autoprint_v3 TO autoprint_api_role, autoprint_worker_role, service_role;
GRANT SELECT, UPDATE ON public.shops TO autoprint_api_role;

CREATE POLICY autoprint_api_public_shops ON public.shops
  FOR ALL TO autoprint_api_role
  USING (true)
  WITH CHECK (true);

-- 5. autoprint_api_role — scoped to tables the API reads/writes
-- Read
GRANT SELECT ON
  autoprint_v3.users,
  autoprint_v3.shop_memberships,
  autoprint_v3.user_sessions,
  autoprint_v3.devices,
  autoprint_v3.device_enrollment_codes,
  autoprint_v3.orders,
  autoprint_v3.source_documents,
  autoprint_v3.print_artifacts,
  autoprint_v3.rate_cards,
  autoprint_v3.price_quotes,
  autoprint_v3.print_jobs,
  autoprint_v3.print_attempts,
  autoprint_v3.job_transitions,
  autoprint_v3.allowed_job_transitions,
  autoprint_v3.audit_events,
  autoprint_v3.idempotency_keys
TO autoprint_api_role;

-- Write (only what the API mutates directly outside of RPCs)
GRANT INSERT, UPDATE ON
  autoprint_v3.user_sessions,
  autoprint_v3.orders,
  autoprint_v3.source_documents,
  autoprint_v3.price_quotes,
  autoprint_v3.device_enrollment_codes,
  autoprint_v3.audit_events,
  autoprint_v3.idempotency_keys
TO autoprint_api_role;

GRANT UPDATE ON autoprint_v3.devices TO autoprint_api_role;

-- 6. autoprint_worker_role — scoped to tables the workers read/write
GRANT SELECT ON
  autoprint_v3.source_documents,
  autoprint_v3.preparation_tasks,
  autoprint_v3.print_artifacts,
  autoprint_v3.orders,
  autoprint_v3.print_jobs
TO autoprint_worker_role;

GRANT INSERT, UPDATE ON
  autoprint_v3.preparation_tasks,
  autoprint_v3.print_artifacts,
  autoprint_v3.source_documents,
  autoprint_v3.orders
TO autoprint_worker_role;

-- 7. service_role — retained for migration use ONLY (never used by app traffic)
-- Comment documents why this is acceptable: service_role never receives a request
-- from the API or workers — it is only granted to the migration runner script.
GRANT ALL ON ALL TABLES    IN SCHEMA autoprint_v3 TO service_role;

-- 8. RLS Policies — api role
CREATE POLICY api_role_users             ON autoprint_v3.users                   FOR ALL TO autoprint_api_role    USING (true) WITH CHECK (true);
CREATE POLICY api_role_memberships       ON autoprint_v3.shop_memberships         FOR ALL TO autoprint_api_role    USING (true) WITH CHECK (true);
CREATE POLICY api_role_sessions          ON autoprint_v3.user_sessions            FOR ALL TO autoprint_api_role    USING (true) WITH CHECK (true);
CREATE POLICY api_role_devices           ON autoprint_v3.devices                  FOR SELECT TO autoprint_api_role USING (true);
CREATE POLICY api_role_enrollments       ON autoprint_v3.device_enrollment_codes  FOR ALL TO autoprint_api_role    USING (true) WITH CHECK (true);
CREATE POLICY api_role_orders            ON autoprint_v3.orders                   FOR ALL TO autoprint_api_role    USING (true) WITH CHECK (true);
CREATE POLICY api_role_source_docs       ON autoprint_v3.source_documents         FOR ALL TO autoprint_api_role    USING (true) WITH CHECK (true);
CREATE POLICY api_role_artifacts         ON autoprint_v3.print_artifacts          FOR SELECT TO autoprint_api_role USING (true);
CREATE POLICY api_role_rate_cards        ON autoprint_v3.rate_cards               FOR SELECT TO autoprint_api_role USING (true);
CREATE POLICY api_role_quotes            ON autoprint_v3.price_quotes             FOR ALL TO autoprint_api_role    USING (true) WITH CHECK (true);
CREATE POLICY api_role_print_jobs        ON autoprint_v3.print_jobs               FOR ALL TO autoprint_api_role    USING (true) WITH CHECK (true);
CREATE POLICY api_role_attempts          ON autoprint_v3.print_attempts           FOR ALL TO autoprint_api_role    USING (true) WITH CHECK (true);
CREATE POLICY api_role_transitions       ON autoprint_v3.job_transitions          FOR ALL TO autoprint_api_role    USING (true) WITH CHECK (true);
CREATE POLICY api_role_audit             ON autoprint_v3.audit_events             FOR INSERT TO autoprint_api_role WITH CHECK (true);
CREATE POLICY api_role_idempotency       ON autoprint_v3.idempotency_keys         FOR ALL TO autoprint_api_role    USING (true) WITH CHECK (true);

-- 9. RLS Policies — worker role
CREATE POLICY worker_role_source_docs    ON autoprint_v3.source_documents         FOR ALL TO autoprint_worker_role USING (true) WITH CHECK (true);
CREATE POLICY worker_role_prep_tasks     ON autoprint_v3.preparation_tasks        FOR ALL TO autoprint_worker_role USING (true) WITH CHECK (true);
CREATE POLICY worker_role_artifacts      ON autoprint_v3.print_artifacts          FOR ALL TO autoprint_worker_role USING (true) WITH CHECK (true);
CREATE POLICY worker_role_orders         ON autoprint_v3.orders                   FOR ALL TO autoprint_worker_role USING (true) WITH CHECK (true);
CREATE POLICY worker_role_print_jobs     ON autoprint_v3.print_jobs               FOR SELECT TO autoprint_worker_role USING (true);

-- 10. service_role RLS (migration use only)
CREATE POLICY service_role_all_users           ON autoprint_v3.users                   FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all_memberships     ON autoprint_v3.shop_memberships         FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all_sessions        ON autoprint_v3.user_sessions            FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all_devices         ON autoprint_v3.devices                  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all_enrollments     ON autoprint_v3.device_enrollment_codes  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all_orders          ON autoprint_v3.orders                   FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all_source_docs     ON autoprint_v3.source_documents         FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all_prep_tasks      ON autoprint_v3.preparation_tasks        FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all_artifacts       ON autoprint_v3.print_artifacts          FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all_rate_cards      ON autoprint_v3.rate_cards               FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all_quotes          ON autoprint_v3.price_quotes             FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all_print_jobs      ON autoprint_v3.print_jobs               FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all_print_attempts  ON autoprint_v3.print_attempts           FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all_transitions     ON autoprint_v3.job_transitions          FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all_allowed_transitions ON autoprint_v3.allowed_job_transitions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all_audit_events    ON autoprint_v3.audit_events             FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all_idempotency     ON autoprint_v3.idempotency_keys         FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 11. Private Storage bucket access for signed grants and worker lifecycle.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('print-jobs', 'print-jobs', false, 26214400, ARRAY['application/pdf']::text[])
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

GRANT USAGE ON SCHEMA storage TO autoprint_api_role, autoprint_worker_role;
GRANT SELECT, INSERT ON storage.objects TO autoprint_api_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO autoprint_worker_role;

CREATE POLICY autoprint_api_storage_objects ON storage.objects
  FOR ALL TO autoprint_api_role
  USING (bucket_id = 'print-jobs')
  WITH CHECK (bucket_id = 'print-jobs');

CREATE POLICY autoprint_worker_storage_objects ON storage.objects
  FOR ALL TO autoprint_worker_role
  USING (bucket_id = 'print-jobs')
  WITH CHECK (bucket_id = 'print-jobs');

COMMIT;
