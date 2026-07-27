-- ============================================================
-- AutoPrint: Privacy, Cleanup & Analytics Schema
-- Run this in Supabase SQL Editor
-- ============================================================

-- ── 1. Schema: Add privacy & analytics tracking columns ──────────────────────

ALTER TABLE public.print_jobs
  -- Privacy & deletion tracking
  ADD COLUMN IF NOT EXISTS file_deleted_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS storage_cleanup_pending BOOLEAN DEFAULT FALSE,

  -- Analytics timestamps (no PII — latency & throughput metrics only)
  ADD COLUMN IF NOT EXISTS started_printing_at  TIMESTAMPTZ,  -- set when agent claims job
  ADD COLUMN IF NOT EXISTS completed_at         TIMESTAMPTZ,  -- set on successful print

  -- Mobile app tracking (already added in mobile_app_rpcs.sql but idempotent)
  ADD COLUMN IF NOT EXISTS install_id           TEXT,
  ADD COLUMN IF NOT EXISTS source               TEXT DEFAULT 'web'
    CHECK (source IN ('web', 'mobile_app', 'api'));

-- ── 2. Indexes for analytics queries ──────────────────────────────────────────

-- Pending storage cleanup retries
CREATE INDEX IF NOT EXISTS idx_print_jobs_cleanup_pending
  ON public.print_jobs (storage_cleanup_pending, file_path)
  WHERE storage_cleanup_pending = TRUE;

-- Time-series analytics (peak hours, throughput)
CREATE INDEX IF NOT EXISTS idx_print_jobs_created_at
  ON public.print_jobs (created_at DESC);

-- Per-shop analytics
CREATE INDEX IF NOT EXISTS idx_print_jobs_shop_created
  ON public.print_jobs (shop_id, created_at DESC);


-- ── 3. Analytics View: Safe product metrics (NO PII, NO filenames) ─────────────
-- Use this for dashboards, monetization insights, and ad targeting by usage pattern.

CREATE OR REPLACE VIEW public.v_print_analytics AS
SELECT
  DATE_TRUNC('hour', created_at)                         AS hour_bucket,
  DATE_TRUNC('day',  created_at)                         AS day_bucket,
  shop_id,
  source,                                                -- 'web' vs 'mobile_app'
  paper_size,
  color_mode,
  duplex,
  status,
  copies,
  page_count,
  -- Latency metrics (no PII)
  EXTRACT(EPOCH FROM (started_printing_at - created_at)) AS upload_to_print_secs,
  EXTRACT(EPOCH FROM (completed_at - started_printing_at)) AS print_duration_secs,
  EXTRACT(EPOCH FROM (completed_at - created_at))        AS total_job_secs,
  -- Privacy markers
  (file_path IS NULL)                                    AS file_deleted,
  file_deleted_at
FROM public.print_jobs;

COMMENT ON VIEW public.v_print_analytics IS
  'Safe analytics view: no file content, no filenames, no install_id. '
  'Use for product metrics, shop insights, and monetization data.';


-- ── 4. Analytics View: Per-shop hourly summary ────────────────────────────────

CREATE OR REPLACE VIEW public.v_shop_hourly_stats AS
SELECT
  shop_id,
  DATE_TRUNC('hour', created_at) AS hour_bucket,
  COUNT(*)                        AS job_count,
  SUM(copies)                     AS total_copies,
  SUM(page_count)                 AS total_pages,
  SUM(CASE WHEN color_mode = 'color' THEN 1 ELSE 0 END) AS color_jobs,
  SUM(CASE WHEN color_mode = 'bw'    THEN 1 ELSE 0 END) AS bw_jobs,
  SUM(CASE WHEN source = 'mobile_app' THEN 1 ELSE 0 END) AS mobile_jobs,
  SUM(CASE WHEN source = 'web'        THEN 1 ELSE 0 END) AS web_jobs,
  AVG(EXTRACT(EPOCH FROM (completed_at - created_at)))   AS avg_job_secs,
  COUNT(CASE WHEN status = 'completed' THEN 1 END)       AS completed_count,
  COUNT(CASE WHEN status = 'failed'    THEN 1 END)       AS failed_count
FROM public.print_jobs
GROUP BY shop_id, DATE_TRUNC('hour', created_at);

COMMENT ON VIEW public.v_shop_hourly_stats IS
  'Per-shop hourly job throughput. Use for shop performance reports and feature decisions.';


-- ── 5. Cleanup helper: identifies orphaned files (for AGENT to delete) ─────────
-- NOTE: This function CANNOT delete Storage objects — only the Windows Agent or
--       a backend function can do that via the SDK.
-- This function returns jobs with orphaned storage references so the agent retries them.
-- The agent's retry_pending_deletions() reads storage_cleanup_pending = TRUE instead.

-- DO NOT use a SQL function to null file_path without actual storage deletion.
-- Doing so loses the reference and makes orphaned files uncleanable.

CREATE OR REPLACE FUNCTION get_orphaned_storage_refs()
RETURNS TABLE(job_id UUID, file_path TEXT, completed_at TIMESTAMPTZ)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT id, file_path, completed_at
  FROM public.print_jobs
  WHERE storage_cleanup_pending = TRUE
    AND file_path IS NOT NULL
  ORDER BY completed_at ASC
  LIMIT 100;
$$;

COMMENT ON FUNCTION get_orphaned_storage_refs IS
  'Returns up to 100 jobs with undeleted storage files. '
  'The Windows Agent calls retry_pending_deletions() which uses storage_cleanup_pending=TRUE index instead. '
  'This function is for manual inspection only.';


-- ── 6. INSTRUCTIONS: Make Storage Bucket Private ──────────────────────────────
-- Step A: Supabase Dashboard → Storage → Buckets
-- Step B: Click '...' next to 'print-files'
-- Step C: Select 'Edit bucket'
-- Step D: Toggle OFF 'Public bucket' → make it Private
-- Step E: Save changes.
--
-- Why: Aadhaar/PAN/medical documents must not be accessible via public URL.
-- The Windows Agent and apps use authenticated SDK calls which still work on private buckets.
-- ═══════════════════════════════════════════════════════════════════════════════
