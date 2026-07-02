-- 1. Create status transition verification helper function
CREATE OR REPLACE FUNCTION public.check_job_status_transition(job_id UUID, new_status TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  current_status TEXT;
BEGIN
  SELECT status INTO current_status FROM public.print_jobs WHERE id = job_id;
  
  IF current_status IS NULL THEN
    RETURN FALSE;
  END IF;
  
  -- If status is not changing, it is valid (no-op update)
  IF current_status = new_status THEN
    RETURN TRUE;
  END IF;
  
  -- Strict state machine rules validation
  RETURN (
    (current_status = 'queued' AND new_status IN ('approved', 'rejected')) OR
    (current_status = 'approved' AND new_status = 'processing') OR
    (current_status = 'processing' AND new_status IN ('completed', 'failed')) OR
    (current_status = 'failed' AND new_status = 'approved')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Drop and recreate update policy on print_jobs to enforce transitions
DROP POLICY IF EXISTS "Allow public update on print jobs" ON public.print_jobs;
CREATE POLICY "Allow public update on print jobs" 
ON public.print_jobs FOR UPDATE 
USING (status IN ('queued', 'approved', 'processing', 'failed'))
WITH CHECK (
  public.check_job_status_transition(id, status)
);

-- 3. Enable real-time replication for print_jobs table
ALTER PUBLICATION supabase_realtime ADD TABLE public.print_jobs;

