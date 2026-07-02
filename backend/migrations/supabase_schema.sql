-- 0. Drop Legacy Tables and Functions for Clean Rebuild
DROP TABLE IF EXISTS public.print_jobs CASCADE;
DROP TABLE IF EXISTS public.shops CASCADE;
DROP FUNCTION IF EXISTS public.claim_next_job();

-- 1. Create Tables
CREATE TABLE IF NOT EXISTS public.shops (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.print_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    copies INTEGER NOT NULL DEFAULT 1 CHECK (copies >= 1),
    page_count INTEGER NOT NULL DEFAULT 1 CHECK (page_count >= 1),
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'printing', 'completed', 'failed')),
    error TEXT,
    cleared_from_console BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 2. Enable Row Level Security (RLS)
ALTER TABLE public.shops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.print_jobs ENABLE ROW LEVEL SECURITY;

-- 3. Create RLS Policies
-- Allow anyone to query active shops
CREATE POLICY "Allow public select on active shops" 
ON public.shops FOR SELECT 
USING (is_active = true);

-- Allow public to query their own jobs
CREATE POLICY "Allow public select on print jobs" 
ON public.print_jobs FOR SELECT 
USING (true);

-- Allow public to create print jobs, enforcing initial status
CREATE POLICY "Allow public insert on print jobs" 
ON public.print_jobs FOR INSERT 
WITH CHECK (
    status = 'queued' 
    AND copies >= 1
);

-- 4. Create Queue Claim RPC Function (SECURITY DEFINER bypasses RLS for status updates)
CREATE OR REPLACE FUNCTION public.claim_next_job()
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

-- 5. Create Generic Events Table for Pilot Telemetry
CREATE TABLE IF NOT EXISTS public.events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS on events table
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

-- Create RLS Policies for events table
CREATE POLICY "Allow public insert on events" 
ON public.events FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Allow public select on events" 
ON public.events FOR SELECT 
USING (true);

