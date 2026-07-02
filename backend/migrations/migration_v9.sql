-- Add paper_size and pages_per_sheet to print_jobs table
ALTER TABLE public.print_jobs 
ADD COLUMN IF NOT EXISTS paper_size TEXT NOT NULL DEFAULT 'A4' CHECK (paper_size IN ('A4', 'A3', 'legal')),
ADD COLUMN IF NOT EXISTS pages_per_sheet INTEGER NOT NULL DEFAULT 1 CHECK (pages_per_sheet IN (1, 2, 4, 6, 9, 16));

-- Update layout_mode check constraint to allow 'photo_grid'
ALTER TABLE public.print_jobs DROP CONSTRAINT IF EXISTS print_jobs_layout_mode_check;
ALTER TABLE public.print_jobs ADD CONSTRAINT print_jobs_layout_mode_check CHECK (layout_mode IN ('document', 'id_card', 'photo_grid'));

-- Redefine queue claim RPC function to return paper_size, pages_per_sheet, and layout_mode
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
  RETURNING id, file_path, file_name, copies, page_count, status, color_mode, duplex, page_range, orientation, fit_mode, layout_mode, paper_size, pages_per_sheet INTO next_job;
  
  IF next_job.id IS NOT NULL THEN
    RETURN row_to_json(next_job);
  END If;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
