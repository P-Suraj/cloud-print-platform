-- ============================================================
-- AutoPrint: Privacy & Automatic File Cleanup Policy
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Ensure columns exist on print_jobs for deletion tracking
ALTER TABLE public.print_jobs
  ADD COLUMN IF NOT EXISTS file_deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS install_id TEXT;

-- 2. Fallback SQL Function: Clean up stale completed/failed/cancelled jobs file_paths
--    (Run periodically or via pg_cron to ensure no orphaned files linger)
CREATE OR REPLACE FUNCTION cleanup_stale_print_files()
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  cleared_count INT := 0;
BEGIN
  -- Null out file_path for any jobs completed or cancelled more than 24 hours ago
  UPDATE public.print_jobs
  SET file_path = NULL,
      file_deleted_at = COALESCE(file_deleted_at, NOW())
  WHERE (status IN ('completed', 'cancelled', 'rejected', 'failed'))
    AND created_at < NOW() - INTERVAL '24 hours'
    AND file_path IS NOT NULL;
    
  GET DIAGNOSTICS cleared_count = ROW_COUNT;
  RETURN cleared_count;
END;
$$;

-- 3. INSTRUCTIONS TO MAKE STORAGE BUCKET PRIVATE:
-- ------------------------------------------------------------
-- Step A: Go to Supabase Dashboard -> Storage -> Buckets
-- Step B: Click the '...' menu next to 'print-files' (or 'print-jobs')
-- Step C: Select 'Edit bucket'
-- Step D: Toggle OFF 'Public bucket' (make it Private)
-- Step E: Save changes.
--
-- Why Private?
-- - Unauthenticated users will NOT be able to view/download uploaded documents
-- - The Windows Agent and Mobile/Web apps use authenticated Supabase API calls which continue working seamlessly
-- - Keeps Aadhaar, PAN cards, resumes, and medical documents 100% private
-- ============================================================
