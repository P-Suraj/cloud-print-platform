-- ============================================================
-- AutoPrint: Mobile App RPCs & Schema Updates
-- Run this in Supabase SQL Editor before running the mobile app
-- ============================================================

-- 1. Add mobile-specific columns to print_jobs
ALTER TABLE public.print_jobs
  ADD COLUMN IF NOT EXISTS install_id    TEXT,
  ADD COLUMN IF NOT EXISTS file_deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source        TEXT DEFAULT 'web'
    CHECK (source IN ('web', 'mobile_app', 'api'));

-- Index for rate limit lookup
CREATE INDEX IF NOT EXISTS idx_print_jobs_install_id
  ON public.print_jobs (install_id, created_at DESC);


-- 2. RPC 1: Dry-run validation (no DB write)
CREATE OR REPLACE FUNCTION validate_print_job(
  p_shop_id    UUID,
  p_copies     INT,
  p_color_mode TEXT,
  p_paper_size TEXT,
  p_page_range TEXT DEFAULT NULL,
  p_install_id TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE shop_ok BOOLEAN; rate_ok BOOLEAN;
BEGIN
  -- Input validation
  IF p_copies < 1 OR p_copies > 99 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Copies must be 1–99');
  END IF;
  IF p_paper_size NOT IN ('A4','A3','Letter','Legal') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unsupported paper size');
  END IF;
  IF p_color_mode NOT IN ('bw','color') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid color mode');
  END IF;
  IF p_page_range IS NOT NULL AND p_page_range != '' AND p_page_range !~ '^[0-9,\-\s]+$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid page range format');
  END IF;

  -- Shop must exist AND be active
  SELECT EXISTS(
    SELECT 1 FROM shops WHERE id = p_shop_id AND is_active = true
  ) INTO shop_ok;
  IF NOT shop_ok THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Shop is not available');
  END IF;

  -- Rate limit: 10 jobs per install per hour
  IF p_install_id IS NOT NULL AND p_install_id != '' THEN
    SELECT (
      SELECT COUNT(*) FROM print_jobs
      WHERE install_id = p_install_id
      AND created_at > NOW() - INTERVAL '1 hour'
    ) < 10 INTO rate_ok;
    IF NOT rate_ok THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Too many jobs. Try again later.');
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;


-- 3. RPC 2: Submit job atomically (validate + rate limit + insert)
CREATE OR REPLACE FUNCTION submit_print_job(
  p_job_id     UUID,
  p_shop_id    UUID,
  p_file_path  TEXT,
  p_file_name  TEXT,
  p_install_id TEXT,
  p_copies     INT,
  p_color_mode TEXT,
  p_duplex     BOOLEAN,
  p_paper_size TEXT,
  p_page_range TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE shop_ok BOOLEAN; rate_ok BOOLEAN;
BEGIN
  -- Re-validate (server is authoritative)
  IF p_copies < 1 OR p_copies > 99 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Copies must be 1–99');
  END IF;
  IF p_paper_size NOT IN ('A4','A3','Letter','Legal') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unsupported paper size');
  END IF;
  IF p_color_mode NOT IN ('bw','color') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid color mode');
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM shops WHERE id = p_shop_id AND is_active = true
  ) INTO shop_ok;
  IF NOT shop_ok THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Shop is not available');
  END IF;

  IF p_install_id IS NOT NULL AND p_install_id != '' THEN
    SELECT (
      SELECT COUNT(*) FROM print_jobs
      WHERE install_id = p_install_id
      AND created_at > NOW() - INTERVAL '1 hour'
    ) < 10 INTO rate_ok;
    IF NOT rate_ok THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Too many jobs. Try again later.');
    END IF;
  END IF;

  -- Insert (idempotent — ON CONFLICT DO NOTHING makes retries safe)
  INSERT INTO print_jobs (
    id, shop_id, file_path, file_name, install_id,
    copies, color_mode, duplex, paper_size, page_range,
    status, source, created_at
  ) VALUES (
    p_job_id, p_shop_id, p_file_path, p_file_name, p_install_id,
    p_copies, p_color_mode, p_duplex, p_paper_size, p_page_range,
    'queued', 'mobile_app', NOW()
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'job_id', p_job_id);
END;
$$;
