-- Migration 0010: refresh PostgREST's schema cache after creating v3 tables.

BEGIN;
NOTIFY pgrst, 'reload schema';
COMMIT;
