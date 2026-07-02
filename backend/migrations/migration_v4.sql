-- 1. Add print_mode column to shops table
ALTER TABLE public.shops 
ADD COLUMN IF NOT EXISTS print_mode TEXT NOT NULL DEFAULT 'manual' CHECK (print_mode IN ('manual', 'auto'));

-- 2. Add color_mode and duplex columns to print_jobs table
ALTER TABLE public.print_jobs 
ADD COLUMN IF NOT EXISTS color_mode TEXT NOT NULL DEFAULT 'bw' CHECK (color_mode IN ('bw', 'color')),
ADD COLUMN IF NOT EXISTS duplex BOOLEAN NOT NULL DEFAULT false;

-- 3. Modify page_count checks to support NULL (Unknown) page counts
ALTER TABLE public.print_jobs ALTER COLUMN page_count DROP NOT NULL;
ALTER TABLE public.print_jobs DROP CONSTRAINT IF EXISTS print_jobs_page_count_check;
ALTER TABLE public.print_jobs ADD CONSTRAINT print_jobs_page_count_check CHECK (page_count IS NULL OR page_count >= 1);

-- 4. Re-create print_jobs status check constraint
ALTER TABLE public.print_jobs DROP CONSTRAINT IF EXISTS print_jobs_status_check;
ALTER TABLE public.print_jobs ADD CONSTRAINT print_jobs_status_check CHECK (status IN ('queued', 'approved', 'processing', 'printing', 'completed', 'failed', 'rejected'));

-- 5. Drop and recreate the RLS policies for print_jobs to allow inserts/updates
DROP POLICY IF EXISTS "Allow public insert on print jobs" ON public.print_jobs;
CREATE POLICY "Allow public insert on print jobs" 
ON public.print_jobs FOR INSERT 
WITH CHECK (
    (status = 'queued' OR status = 'approved') 
    AND copies >= 1
);

DROP POLICY IF EXISTS "Allow public update on print jobs" ON public.print_jobs;
CREATE POLICY "Allow public update on print jobs" 
ON public.print_jobs FOR UPDATE 
USING (true)
WITH CHECK (true);

-- 6. RPC function to update shop print mode securely (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.update_shop_print_mode(target_shop_id UUID, new_mode TEXT)
RETURNS VOID AS $$
BEGIN
  IF new_mode NOT IN ('manual', 'auto') THEN
    RAISE EXCEPTION 'Invalid print mode: %', new_mode;
  END IF;
  
  UPDATE public.shops
  SET print_mode = new_mode
  WHERE id = target_shop_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Redefine queue claim RPC function to poll approved jobs and set them to processing
CREATE OR REPLACE FUNCTION public.claim_next_job(target_shop_id UUID)
RETURNS JSON AS $$
DECLARE
  next_job RECORD;
BEGIN
  UPDATE public.print_jobs
  SET status = 'processing', updated_at = now()
  WHERE id = (
    SELECT id
    FROM public.print_jobs
    WHERE status = 'approved'
      AND shop_id = target_shop_id
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING id, file_path, file_name, copies, page_count, status, color_mode, duplex INTO next_job;
  
  IF next_job.id IS NOT NULL THEN
    RETURN row_to_json(next_job);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
