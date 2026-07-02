-- 1. Create generic events table for pilot telemetry
CREATE TABLE IF NOT EXISTS public.events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 2. Enable Row Level Security (RLS)
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

-- 3. Create RLS Policies
-- Allow anyone to insert telemetry events
CREATE POLICY "Allow public insert on events" 
ON public.events FOR INSERT 
WITH CHECK (true);

-- Allow anyone to read telemetry events
CREATE POLICY "Allow public select on events" 
ON public.events FOR SELECT 
USING (true);
