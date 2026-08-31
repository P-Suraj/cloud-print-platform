-- AutoPrint v3 Database Preflight Inventory Script (Read-Only)
-- Purpose: Export PostgreSQL version, extensions, schema tables, views, enums, columns, constraints, RLS policies, grants, and bucket state.
-- Safety: READ-ONLY queries. No tables are modified, dropped, or mutated.

-- 1. PostgreSQL Version and Installed Extensions
SELECT 'VERSION' AS section, version() AS details;

SELECT 'EXTENSIONS' AS section, extname, extversion 
FROM pg_extension 
ORDER BY extname;

-- 2. Tables and Views Inventory (public and autoprint_v3 namespaces)
SELECT 'TABLES_AND_VIEWS' AS section, table_schema, table_name, table_type 
FROM information_schema.tables 
WHERE table_schema IN ('public', 'autoprint_v3')
ORDER BY table_schema, table_name;

-- 3. Columns Inventory
SELECT 'COLUMNS' AS section, table_schema, table_name, column_name, ordinal_position, data_type, is_nullable, column_default 
FROM information_schema.columns 
WHERE table_schema IN ('public', 'autoprint_v3')
ORDER BY table_schema, table_name, ordinal_position;

-- 4. Enum Types Inventory
SELECT 'ENUMS' AS section, n.nspname AS schema_name, t.typname AS enum_name, e.enumlabel AS enum_value
FROM pg_type t
JOIN pg_enum e ON t.oid = e.enumtypid
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname IN ('public', 'autoprint_v3')
ORDER BY schema_name, enum_name, e.enumsortorder;

-- 5. Constraints Inventory
SELECT 'CONSTRAINTS' AS section, tc.table_schema, tc.table_name, tc.constraint_name, tc.constraint_type
FROM information_schema.table_constraints tc
WHERE tc.table_schema IN ('public', 'autoprint_v3')
ORDER BY tc.table_schema, tc.table_name, tc.constraint_name;

-- 6. RLS Enabled / Forced State
SELECT 'RLS_STATE' AS section, n.nspname AS schema_name, c.relname AS table_name, c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public', 'autoprint_v3') AND c.relkind = 'r'
ORDER BY schema_name, table_name;

-- 7. RLS Policies Inventory
SELECT 'RLS_POLICIES' AS section, schemaname, tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname IN ('public', 'autoprint_v3', 'storage')
ORDER BY schemaname, tablename, policyname;

-- 8. Functions & Security Settings Inventory
SELECT 'FUNCTIONS' AS section, n.nspname AS schema_name, p.proname AS function_name, pg_get_function_identity_arguments(p.oid) AS arguments, p.prosecdef AS is_security_definer
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('public', 'autoprint_v3')
ORDER BY schema_name, function_name;

-- 9. Table Grants Inventory
SELECT 'TABLE_GRANTS' AS section, table_schema, table_name, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema IN ('public', 'autoprint_v3') AND grantee IN ('anon', 'authenticated', 'service_role')
ORDER BY table_schema, table_name, grantee, privilege_type;

-- 10. Storage Buckets Inventory
SELECT 'STORAGE_BUCKETS' AS section, id, name, public, avif_autodetection, file_size_limit, allowed_mime_types
FROM storage.buckets
WHERE name IN ('print-jobs', 'print-files');

-- 11. Product Table Row Counts Only (No sensitive data exposed)
SELECT 'ROW_COUNTS' AS section, 'public.shops' AS table_name, count(*) AS total_rows FROM public.shops
UNION ALL
SELECT 'ROW_COUNTS' AS section, 'public.print_jobs' AS table_name, count(*) AS total_rows FROM public.print_jobs;
