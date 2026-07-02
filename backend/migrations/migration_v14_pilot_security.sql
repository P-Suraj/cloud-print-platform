-- AutoPrint Pilot Security Hardening (v14)
-- Run this in the Supabase SQL Editor before the university pilot.
-- Execute all statements in order.

-- =============================================================================
-- 1. Lock down the customers table (created in v12, not used in pilot)
-- =============================================================================
DROP POLICY IF EXISTS "Allow public select on customers" ON public.customers;
DROP POLICY IF EXISTS "Allow public insert on customers" ON public.customers;
DROP POLICY IF EXISTS "Allow public update on customers" ON public.customers;

CREATE POLICY "Deny all public access to customers"
ON public.customers FOR ALL
USING (false);

-- =============================================================================
-- 2. Lock down the jobs table (created in v12, not used in pilot)
-- =============================================================================
DROP POLICY IF EXISTS "Allow public select on jobs" ON public.jobs;
DROP POLICY IF EXISTS "Allow public insert on jobs" ON public.jobs;
DROP POLICY IF EXISTS "Allow public update on jobs" ON public.jobs;

CREATE POLICY "Deny all public access to jobs"
ON public.jobs FOR ALL
USING (false);

-- =============================================================================
-- 3. Lock down the job_files table (created in v12, not used in pilot)
-- =============================================================================
DROP POLICY IF EXISTS "Allow public select on job_files" ON public.job_files;
DROP POLICY IF EXISTS "Allow public insert on job_files" ON public.job_files;

CREATE POLICY "Deny all public access to job_files"
ON public.job_files FOR ALL
USING (false);

-- =============================================================================
-- 4. Lock down the payments table (created in v12, not used in pilot)
-- =============================================================================
DROP POLICY IF EXISTS "Allow public select on payments" ON public.payments;
DROP POLICY IF EXISTS "Allow public insert on payments" ON public.payments;

CREATE POLICY "Deny all public access to payments"
ON public.payments FOR ALL
USING (false);

-- =============================================================================
-- 5. Add file_deleted_at column to print_jobs for auditing
--    This timestamps when a file was deleted from cloud storage.
-- =============================================================================
ALTER TABLE public.print_jobs
ADD COLUMN IF NOT EXISTS file_deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- =============================================================================
-- 6. VERIFICATION QUERIES
--    Run these after the migration to confirm policies are in place.
--    Each should return 0 rows when called from an anon/public context.
-- =============================================================================
-- SELECT * FROM public.customers LIMIT 1;  -- Should return error or 0 rows
-- SELECT * FROM public.jobs LIMIT 1;        -- Should return error or 0 rows
-- SELECT * FROM public.payments LIMIT 1;    -- Should return error or 0 rows
