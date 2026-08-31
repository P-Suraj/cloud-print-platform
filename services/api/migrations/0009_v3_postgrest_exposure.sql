-- Migration 0009: expose the v3 application schema through PostgREST.
-- Storage remains private and is served only by the Supabase Storage API.

BEGIN;

ALTER ROLE authenticator
  SET pgrst.db_schemas = 'public, graphql_public, autoprint_v3';

-- PostgREST listens for this notification and reloads database role settings.
NOTIFY pgrst, 'reload config';

COMMIT;
