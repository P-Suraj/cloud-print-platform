-- Migration 0002: v3 Constraints and Indexes Schema
-- Target Namespace: autoprint_v3

BEGIN;

-- 1. Check Constraints
ALTER TABLE autoprint_v3.source_documents
  ADD CONSTRAINT chk_source_docs_declared_size CHECK (declared_byte_size > 0),
  ADD CONSTRAINT chk_source_docs_verified_size CHECK (verified_byte_size IS NULL OR verified_byte_size > 0);

ALTER TABLE autoprint_v3.print_artifacts
  ADD CONSTRAINT chk_artifacts_page_count CHECK (logical_page_count > 0),
  ADD CONSTRAINT chk_artifacts_byte_size CHECK (byte_size > 0);

ALTER TABLE autoprint_v3.price_quotes
  ADD CONSTRAINT chk_quotes_total_amount CHECK (total_amount >= 0);

ALTER TABLE autoprint_v3.orders
  ADD CONSTRAINT chk_orders_expiry_after_creation CHECK (expires_at > created_at);

ALTER TABLE autoprint_v3.preparation_tasks
  ADD CONSTRAINT chk_prep_tasks_attempts CHECK (attempt_count >= 0);

ALTER TABLE autoprint_v3.source_documents
  ADD CONSTRAINT chk_source_cleanup_attempts CHECK (cleanup_attempt_count >= 0);

ALTER TABLE autoprint_v3.print_artifacts
  ADD CONSTRAINT chk_artifact_cleanup_attempts CHECK (cleanup_attempt_count >= 0);

-- 2. Performance Indexes
CREATE INDEX idx_orders_shop_status ON autoprint_v3.orders(shop_id, status);
CREATE INDEX idx_orders_capability ON autoprint_v3.orders(capability_hash);
CREATE INDEX idx_sessions_user ON autoprint_v3.user_sessions(user_id);
CREATE INDEX idx_sessions_token ON autoprint_v3.user_sessions(token_hash);
CREATE INDEX idx_devices_shop_status ON autoprint_v3.devices(shop_id, status);
CREATE INDEX idx_enrollment_codes_hash ON autoprint_v3.device_enrollment_codes(code_hash);
CREATE INDEX idx_source_docs_order ON autoprint_v3.source_documents(order_id);
CREATE INDEX idx_prep_tasks_claimable ON autoprint_v3.preparation_tasks(status, lease_expires_at) WHERE status IN ('pending', 'leased');
CREATE INDEX idx_artifacts_source ON autoprint_v3.print_artifacts(source_document_id);
CREATE INDEX idx_quotes_order ON autoprint_v3.price_quotes(order_id);
CREATE INDEX idx_print_jobs_claimable ON autoprint_v3.print_jobs(shop_id, status, created_at) WHERE status = 'waiting_for_shop' AND approved_at IS NOT NULL;
CREATE INDEX idx_print_attempts_fencing ON autoprint_v3.print_attempts(fencing_token);
CREATE INDEX idx_print_attempts_job ON autoprint_v3.print_attempts(job_id);
CREATE INDEX idx_job_transitions_job ON autoprint_v3.job_transitions(job_id);
CREATE INDEX idx_audit_events_shop ON autoprint_v3.audit_events(shop_id, created_at);
CREATE INDEX idx_idempotency_lookup ON autoprint_v3.idempotency_keys(scope, key_hash);

COMMIT;
