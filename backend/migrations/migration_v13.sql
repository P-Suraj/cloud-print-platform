-- 1. Add cleared_from_console column to print_jobs table
ALTER TABLE public.print_jobs ADD COLUMN IF NOT EXISTS cleared_from_console BOOLEAN DEFAULT false;

-- 2. Drop and recreate update policy on print_jobs to allow updates to any job,
-- relying on check_job_status_transition to enforce valid status changes.
DROP POLICY IF EXISTS "Allow public update on print jobs" ON public.print_jobs;
CREATE POLICY "Allow public update on print jobs" 
ON public.print_jobs FOR UPDATE 
USING (true)
WITH CHECK (
  public.check_job_status_transition(id, status)
);
