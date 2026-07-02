-- AutoPrint OS Transformation (v12)

-- 1. Create Customers Table (Re-creating fully here to avoid missing relation issues)
CREATE TABLE IF NOT EXISTS public.customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    customer_type TEXT DEFAULT 'walk_in' CHECK (customer_type IN ('walk_in', 'student', 'corporate', 'institution', 'government')),
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    company_name TEXT,
    company TEXT,
    gstin TEXT,
    address TEXT,
    credit_limit NUMERIC DEFAULT 0,
    payment_terms TEXT DEFAULT 'Net 30',
    notes TEXT,
    agreed_rate_bw NUMERIC,
    agreed_rate_color NUMERIC,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 2. Create Jobs Table
CREATE TABLE IF NOT EXISTS public.jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
    print_job_id UUID REFERENCES public.print_jobs(id) ON DELETE SET NULL,
    job_number SERIAL,
    title TEXT NOT NULL,
    description TEXT,
    service_type TEXT NOT NULL DEFAULT 'printing' CHECK (service_type IN ('printing', 'xerox', 'binding', 'lamination', 'id_card', 'certificate', 'custom')),
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'quoted', 'approved', 'prepress', 'printing', 'finishing', 'ready', 'delivered', 'cancelled')),
    priority TEXT DEFAULT 'normal',
    due_date TIMESTAMP WITH TIME ZONE,
    amount NUMERIC DEFAULT 0.0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 3. Create Job Files Table
CREATE TABLE IF NOT EXISTS public.job_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    file_hash TEXT,
    page_count INTEGER,
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 4. Create Payments Table
CREATE TABLE IF NOT EXISTS public.payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
    amount NUMERIC NOT NULL,
    payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'upi', 'bank_transfer', 'cheque', 'credit')),
    payment_date TIMESTAMP WITH TIME ZONE DEFAULT now(),
    notes TEXT
);

-- 5. Enable RLS
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- 6. RLS Policies
CREATE POLICY "Allow public select on customers" ON public.customers FOR SELECT USING (true);
CREATE POLICY "Allow public insert on customers" ON public.customers FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update on customers" ON public.customers FOR UPDATE USING (true);

CREATE POLICY "Allow public select on jobs" ON public.jobs FOR SELECT USING (true);
CREATE POLICY "Allow public insert on jobs" ON public.jobs FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update on jobs" ON public.jobs FOR UPDATE USING (true);

CREATE POLICY "Allow public select on job_files" ON public.job_files FOR SELECT USING (true);
CREATE POLICY "Allow public insert on job_files" ON public.job_files FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public select on payments" ON public.payments FOR SELECT USING (true);
CREATE POLICY "Allow public insert on payments" ON public.payments FOR INSERT WITH CHECK (true);

-- 7. Trigger to sync print_jobs status to jobs
CREATE OR REPLACE FUNCTION public.sync_print_job_to_job()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
        UPDATE public.jobs 
        SET status = CASE 
            WHEN service_type IN ('binding', 'lamination', 'id_card', 'certificate', 'custom') THEN 'finishing'
            ELSE 'ready'
        END,
        updated_at = now()
        WHERE print_job_id = NEW.id AND status IN ('prepress', 'printing');
    ELSIF NEW.status = 'printing' AND OLD.status != 'printing' THEN
        UPDATE public.jobs
        SET status = 'printing', updated_at = now()
        WHERE print_job_id = NEW.id AND status = 'prepress';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sync_print_job_status ON public.print_jobs;
CREATE TRIGGER trg_sync_print_job_status
AFTER UPDATE ON public.print_jobs
FOR EACH ROW EXECUTE FUNCTION public.sync_print_job_to_job();