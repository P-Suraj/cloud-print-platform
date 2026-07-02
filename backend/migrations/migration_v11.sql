-- Smart Ledger & Auto-Billing Schema
-- Phase 1: B2B Customers and Ledger Entries

-- 1. Create Customers Table
CREATE TABLE IF NOT EXISTS public.customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    phone TEXT,
    company TEXT,
    agreed_rate_bw NUMERIC,
    agreed_rate_color NUMERIC,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 2. Create Ledger Entries Table
CREATE TABLE IF NOT EXISTS public.ledger_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    print_job_id UUID REFERENCES public.print_jobs(id) ON DELETE SET NULL,
    job_description TEXT NOT NULL,
    pages INTEGER DEFAULT 0,
    amount NUMERIC NOT NULL DEFAULT 0.0,
    status TEXT NOT NULL DEFAULT 'unbilled' CHECK (status IN ('unbilled', 'billed', 'paid')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 3. Enable RLS
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies
-- Note: Assuming public for MVP matching existing pilot policies.
CREATE POLICY "Allow public select on customers" 
ON public.customers FOR SELECT USING (true);

CREATE POLICY "Allow public insert on customers" 
ON public.customers FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public update on customers" 
ON public.customers FOR UPDATE USING (true);

CREATE POLICY "Allow public select on ledger_entries" 
ON public.ledger_entries FOR SELECT USING (true);

CREATE POLICY "Allow public insert on ledger_entries" 
ON public.ledger_entries FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public update on ledger_entries" 
ON public.ledger_entries FOR UPDATE USING (true);
