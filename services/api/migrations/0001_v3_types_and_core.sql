-- Migration 0001: v3 Types and Core Tables Schema
-- Target Namespace: autoprint_v3

BEGIN;

CREATE SCHEMA IF NOT EXISTS autoprint_v3;

-- 1. Create Enums
CREATE TYPE autoprint_v3.migration_mode AS ENUM (
  'legacy', 'shadow_read', 'v3_canary', 'v3_active', 'rollback_pending'
);

CREATE TYPE autoprint_v3.membership_role AS ENUM (
  'owner', 'staff', 'founder_admin', 'technician'
);

CREATE TYPE autoprint_v3.device_status AS ENUM (
  'active', 'revoked'
);

CREATE TYPE autoprint_v3.order_status AS ENUM (
  'uploading', 'preparing', 'ready_for_approval', 'waiting_for_shop', 'printing', 'needs_attention', 'completed', 'failed', 'rejected', 'cancelled'
);

CREATE TYPE autoprint_v3.preparation_status AS ENUM (
  'pending', 'leased', 'completed', 'failed'
);

CREATE TYPE autoprint_v3.cleanup_status AS ENUM (
  'pending', 'leased', 'deleted', 'failed'
);

CREATE TYPE autoprint_v3.job_status AS ENUM (
  'waiting_for_shop', 'printing', 'needs_attention', 'completed', 'failed', 'rejected', 'cancelled'
);

CREATE TYPE autoprint_v3.attempt_status AS ENUM (
  'leased', 'artifact_verified', 'submission_intent_recorded', 'submission_process_started', 'submission_accepted', 'spooler_observed', 'outcome_reported', 'confirmed_printed', 'confirmed_not_printed', 'outcome_uncertain'
);

CREATE TYPE autoprint_v3.actor_type AS ENUM (
  'anonymous_customer', 'shop_user', 'device', 'founder_admin', 'system', 'preparation_worker'
);

CREATE TYPE autoprint_v3.completion_source AS ENUM (
  'operator_confirmed', 'spooler_presumed', 'device_telemetry_confirmed'
);

-- 2. Create Core Tables
CREATE TABLE autoprint_v3.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_provider text NOT NULL DEFAULT 'local',
  identity_subject text NOT NULL,
  email text,
  display_name text,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_identity_unique UNIQUE (identity_provider, identity_subject)
);

CREATE TABLE autoprint_v3.shop_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES autoprint_v3.users(id) ON DELETE CASCADE,
  role autoprint_v3.membership_role NOT NULL DEFAULT 'staff',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shop_memberships_unique UNIQUE (shop_id, user_id)
);

CREATE TABLE autoprint_v3.user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES autoprint_v3.users(id) ON DELETE CASCADE,
  shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  role autoprint_v3.membership_role NOT NULL,
  token_hash text NOT NULL UNIQUE,
  csrf_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_active_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE autoprint_v3.devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  credential_hash text NOT NULL,
  status autoprint_v3.device_status NOT NULL DEFAULT 'active',
  agent_version text,
  agent_contract_version integer NOT NULL DEFAULT 3,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE autoprint_v3.device_enrollment_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  created_by_user_id uuid NOT NULL REFERENCES autoprint_v3.users(id),
  code_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  consumed_by_device_id uuid REFERENCES autoprint_v3.devices(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE autoprint_v3.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops(id),
  capability_hash text NOT NULL UNIQUE,
  capability_permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  schema_version integer NOT NULL DEFAULT 3,
  status autoprint_v3.order_status NOT NULL DEFAULT 'uploading',
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE autoprint_v3.source_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES autoprint_v3.orders(id) ON DELETE CASCADE,
  object_path text NOT NULL UNIQUE,
  original_file_name text NOT NULL,
  declared_media_type text NOT NULL,
  verified_media_type text,
  declared_byte_size bigint NOT NULL,
  verified_byte_size bigint,
  sha256 text,
  finalized_at timestamptz,
  retention_until timestamptz,
  cleanup_status autoprint_v3.cleanup_status NOT NULL DEFAULT 'pending',
  cleanup_lease_token text,
  cleanup_lease_expires_at timestamptz,
  cleanup_attempt_count integer NOT NULL DEFAULT 0,
  delete_error text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE autoprint_v3.preparation_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_document_id uuid NOT NULL REFERENCES autoprint_v3.source_documents(id) ON DELETE CASCADE,
  options_hash text NOT NULL,
  status autoprint_v3.preparation_status NOT NULL DEFAULT 'pending',
  lease_owner text,
  lease_token text,
  lease_expires_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prep_tasks_doc_options_unique UNIQUE (source_document_id, options_hash)
);

CREATE TABLE autoprint_v3.print_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_document_id uuid NOT NULL REFERENCES autoprint_v3.source_documents(id),
  object_path text NOT NULL UNIQUE,
  sha256 text NOT NULL,
  preparation_version integer NOT NULL DEFAULT 1,
  renderer_name text NOT NULL,
  renderer_version text NOT NULL,
  logical_page_count integer NOT NULL,
  byte_size bigint NOT NULL,
  retention_until timestamptz,
  cleanup_status autoprint_v3.cleanup_status NOT NULL DEFAULT 'pending',
  cleanup_lease_token text,
  cleanup_lease_expires_at timestamptz,
  cleanup_attempt_count integer NOT NULL DEFAULT 0,
  delete_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT print_artifacts_source_version_unique UNIQUE (source_document_id, preparation_version),
  deleted_at timestamptz
);

CREATE TABLE autoprint_v3.rate_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1,
  currency text NOT NULL DEFAULT 'INR',
  rules_json jsonb NOT NULL,
  effective_from timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  created_by_user_id uuid REFERENCES autoprint_v3.users(id),
  CONSTRAINT rate_cards_shop_version_unique UNIQUE (shop_id, version)
);

CREATE TABLE autoprint_v3.price_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES autoprint_v3.orders(id),
  artifact_id uuid NOT NULL REFERENCES autoprint_v3.print_artifacts(id),
  artifact_sha256 text NOT NULL,
  options_json jsonb NOT NULL,
  options_hash text NOT NULL,
  rate_card_id uuid NOT NULL REFERENCES autoprint_v3.rate_cards(id),
  rate_card_version integer NOT NULL,
  breakdown_json jsonb NOT NULL,
  total_amount numeric(10,2) NOT NULL,
  currency text NOT NULL DEFAULT 'INR',
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE autoprint_v3.print_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES autoprint_v3.orders(id),
  shop_id uuid NOT NULL REFERENCES public.shops(id),
  artifact_id uuid NOT NULL REFERENCES autoprint_v3.print_artifacts(id),
  quote_id uuid NOT NULL REFERENCES autoprint_v3.price_quotes(id),
  schema_version integer NOT NULL DEFAULT 3,
  status autoprint_v3.job_status NOT NULL DEFAULT 'waiting_for_shop',
  approved_at timestamptz,
  approved_by_user_id uuid REFERENCES autoprint_v3.users(id),
  current_attempt_id uuid,
  completion_source autoprint_v3.completion_source,
  completion_evidence_json jsonb,
  completed_at timestamptz,
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
  ,CONSTRAINT print_jobs_quote_unique UNIQUE (quote_id)
);

CREATE TABLE autoprint_v3.print_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES autoprint_v3.print_jobs(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES autoprint_v3.devices(id),
  fencing_token text NOT NULL UNIQUE,
  status autoprint_v3.attempt_status NOT NULL DEFAULT 'leased',
  lease_expires_at timestamptz NOT NULL,
  last_renewed_at timestamptz NOT NULL DEFAULT now(),
  artifact_sha256 text NOT NULL,
  options_hash text NOT NULL,
  spooler_job_id integer,
  last_spooler_state text,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Add Foreign Key for print_jobs.current_attempt_id
ALTER TABLE autoprint_v3.print_jobs 
  ADD CONSTRAINT fk_jobs_current_attempt 
  FOREIGN KEY (current_attempt_id) REFERENCES autoprint_v3.print_attempts(id);

CREATE TABLE autoprint_v3.job_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES autoprint_v3.print_jobs(id) ON DELETE CASCADE,
  attempt_id uuid REFERENCES autoprint_v3.print_attempts(id),
  from_status autoprint_v3.job_status,
  to_status autoprint_v3.job_status NOT NULL,
  actor_type autoprint_v3.actor_type NOT NULL,
  actor_id uuid,
  reason_code text,
  evidence_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE autoprint_v3.allowed_job_transitions (
  from_status autoprint_v3.job_status NOT NULL,
  to_status autoprint_v3.job_status NOT NULL,
  actor_type autoprint_v3.actor_type NOT NULL,
  PRIMARY KEY (from_status, to_status, actor_type)
);

CREATE TABLE autoprint_v3.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid REFERENCES public.shops(id),
  actor_type autoprint_v3.actor_type NOT NULL,
  actor_id uuid,
  event_type text NOT NULL,
  target_type text,
  target_id uuid,
  request_id text,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE autoprint_v3.idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL,
  key_hash text NOT NULL,
  request_hash text NOT NULL,
  response_status integer NOT NULL,
  response_json jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT idempotency_scope_key_unique UNIQUE (scope, key_hash)
);

COMMIT;
