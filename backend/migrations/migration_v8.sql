-- 1. Add printer mapping columns to shops table
ALTER TABLE public.shops 
ADD COLUMN IF NOT EXISTS printer_bw TEXT,
ADD COLUMN IF NOT EXISTS printer_color TEXT;

-- 2. Add advanced printing columns to print_jobs table
ALTER TABLE public.print_jobs 
ADD COLUMN IF NOT EXISTS page_range TEXT,
ADD COLUMN IF NOT EXISTS orientation TEXT NOT NULL DEFAULT 'auto' CHECK (orientation IN ('portrait', 'landscape', 'auto')),
ADD COLUMN IF NOT EXISTS fit_mode TEXT NOT NULL DEFAULT 'fit' CHECK (fit_mode IN ('fit', 'noscale', 'shrink')),
ADD COLUMN IF NOT EXISTS layout_mode TEXT NOT NULL DEFAULT 'document' CHECK (layout_mode IN ('document', 'id_card'));

-- 3. Redefine queue claim RPC function to return the new advanced layout settings
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
  RETURNING id, file_path, file_name, copies, page_count, status, color_mode, duplex, page_range, orientation, fit_mode, layout_mode INTO next_job;
  
  IF next_job.id IS NOT NULL THEN
    RETURN row_to_json(next_job);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
