-- Fix claim_next_job to pick up both 'queued' and 'approved' jobs.
-- Manual-mode shops submit status='queued', auto-mode shops submit status='approved'.
-- The old function only looked for 'approved', so manual-mode jobs were stuck forever.

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
    WHERE status IN ('queued', 'approved')
      AND shop_id = target_shop_id
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING id, file_path, file_name, copies, page_count, status,
            color_mode, duplex, page_range, orientation, fit_mode,
            layout_mode, paper_size, pages_per_sheet INTO next_job;

  IF next_job.id IS NOT NULL THEN
    RETURN row_to_json(next_job);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Also reset the one job stuck as 'processing' since 18:10
UPDATE public.print_jobs
SET status = 'failed',
    error = 'Stuck processing — reset after agent crash recovery'
WHERE status = 'processing'
  AND updated_at < now() - interval '1 hour';
