-- ============================================================
-- AutoPrint: Feedback & Bug Reports Schema for Supabase
-- ============================================================

CREATE TABLE IF NOT EXISTS public.feedback_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_type TEXT NOT NULL CHECK (report_type IN ('bug', 'feedback', 'feature')),
    user_message VARCHAR(500) NOT NULL,
    shop_id TEXT,
    job_id TEXT,
    file_name TEXT,
    doc_format TEXT,
    page_count INTEGER,
    copies INTEGER,
    color_mode TEXT,
    duplex BOOLEAN,
    job_status TEXT,
    job_error TEXT,
    diagnostics JSONB,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Row Level Security (RLS)
ALTER TABLE public.feedback_reports ENABLE ROW LEVEL SECURITY;

-- Allow anyone (public/students/shopkeepers) to submit feedback
CREATE POLICY "Allow public insert on feedback_reports"
ON public.feedback_reports FOR INSERT
WITH CHECK (true);

-- Allow public reading for admin dashboard queries
CREATE POLICY "Allow public select on feedback_reports"
ON public.feedback_reports FOR SELECT
USING (true);
