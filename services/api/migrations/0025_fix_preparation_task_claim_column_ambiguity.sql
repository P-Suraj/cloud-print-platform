-- Migration 0025: fix the inline preparation claim RPC.
--
-- A RETURNS TABLE output named source_document_id is a PL/pgSQL variable.
-- The unqualified column in the WHERE clause of the 0024 function therefore
-- raises PostgreSQL 42702 (ambiguous_column) whenever it is invoked.
BEGIN;

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
  SELECT task.* INTO v_task
  FROM autoprint_v3.preparation_tasks AS task
  WHERE task.source_document_id = p_source_document_id
    AND task.status IN ('pending', 'leased')
    AND (task.lease_expires_at IS NULL OR task.lease_expires_at < now())
  ORDER BY task.created_at DESC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_task.id IS NULL THEN
    RETURN;
  END IF;

  v_token := encode(extensions.gen_random_bytes(16), 'hex');

  UPDATE autoprint_v3.preparation_tasks AS task
  SET status = 'leased',
      lease_owner = p_worker_id,
      lease_token = v_token,
      lease_expires_at = now() + (p_lease_seconds || ' seconds')::interval,
      attempt_count = task.attempt_count + 1,
      updated_at = now()
  WHERE task.id = v_task.id;

  SELECT document.* INTO v_doc
  FROM autoprint_v3.source_documents AS document
  WHERE document.id = p_source_document_id;

  RETURN QUERY SELECT
    v_task.id,
    v_task.source_document_id,
    v_doc.object_path,
    v_doc.sha256,
    v_task.options_hash,
    v_token;
END;
$$;

GRANT EXECUTE ON FUNCTION autoprint_v3.claim_preparation_task_for_document(uuid, text, integer)
  TO autoprint_api_role, autoprint_worker_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
