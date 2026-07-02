-- Add bw_slabs and color_slabs JSONB columns to public.shops table
ALTER TABLE public.shops 
ADD COLUMN IF NOT EXISTS bw_slabs JSONB DEFAULT '[{"min": 1, "max": null, "rate": 2.0, "duplex_rate": 1.8}]'::jsonb,
ADD COLUMN IF NOT EXISTS color_slabs JSONB DEFAULT '[{"min": 1, "max": null, "rate": 10.0, "duplex_rate": 9.0}]'::jsonb;

-- Populate default values for existing shops if they are null
UPDATE public.shops 
SET bw_slabs = '[{"min": 1, "max": null, "rate": 2.0, "duplex_rate": 1.8}]'::jsonb
WHERE bw_slabs IS NULL;

UPDATE public.shops 
SET color_slabs = '[{"min": 1, "max": null, "rate": 10.0, "duplex_rate": 9.0}]'::jsonb
WHERE color_slabs IS NULL;
