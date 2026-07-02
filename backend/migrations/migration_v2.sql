-- 1. Add heartbeat column to shops
ALTER TABLE public.shops 
ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP WITH TIME ZONE;

-- 2. Drop the old single-tenant function
DROP FUNCTION IF EXISTS public.claim_next_job();

-- 3. Create the new multi-tenant claim function
CREATE OR REPLACE FUNCTION public.claim_next_job(target_shop_id UUID)
RETURNS JSON AS $$
DECLARE
  next_job RECORD;
BEGIN
  UPDATE public.print_jobs
  SET status = 'printing', updated_at = now()
  WHERE id = (
    SELECT id
    FROM public.print_jobs
    WHERE status = 'queued'
      AND shop_id = target_shop_id
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING id, file_path, file_name, copies, page_count, status INTO next_job;
  
  IF next_job.id IS NOT NULL THEN
    RETURN row_to_json(next_job);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
