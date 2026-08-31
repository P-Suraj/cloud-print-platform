-- Migration 0011: allow fenced lease functions to resolve pgcrypto safely.
-- Supabase installs gen_random_bytes in the trusted extensions schema.

BEGIN;

ALTER FUNCTION autoprint_v3.claim_next_print_job(uuid, integer)
  SET search_path = autoprint_v3, public, extensions, pg_temp;

ALTER FUNCTION autoprint_v3.claim_preparation_task(text, integer)
  SET search_path = autoprint_v3, public, extensions, pg_temp;

NOTIFY pgrst, 'reload schema';

COMMIT;
