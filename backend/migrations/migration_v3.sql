-- 1. Add shop_code column to public.shops table
ALTER TABLE public.shops 
ADD COLUMN IF NOT EXISTS shop_code TEXT UNIQUE;

-- 2. Create index on shop_code for fast lookup resolution
CREATE INDEX IF NOT EXISTS idx_shops_shop_code ON public.shops(shop_code);

-- 3. Seed the default pilot shop with a test shop code 'KRL004'
UPDATE public.shops 
SET shop_code = 'KRL004' 
WHERE id = '1bb3cb6a-869d-4c30-85d0-59992d7250e7';
