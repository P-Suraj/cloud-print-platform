-- 1. Add rate columns and pilot start date to shops table
ALTER TABLE public.shops 
ADD COLUMN IF NOT EXISTS rate_bw_simplex NUMERIC(10, 2) NOT NULL DEFAULT 2.00,
ADD COLUMN IF NOT EXISTS rate_bw_duplex NUMERIC(10, 2) NOT NULL DEFAULT 1.80,
ADD COLUMN IF NOT EXISTS rate_color_simplex NUMERIC(10, 2) NOT NULL DEFAULT 5.00,
ADD COLUMN IF NOT EXISTS rate_color_duplex NUMERIC(10, 2) NOT NULL DEFAULT 4.50,
ADD COLUMN IF NOT EXISTS pilot_start_date DATE NOT NULL DEFAULT CURRENT_DATE;

-- 2. Create or replace secure RPC function to update shop rates (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.update_shop_rates(
  target_shop_id UUID,
  new_rate_bw_simplex NUMERIC,
  new_rate_bw_duplex NUMERIC,
  new_rate_color_simplex NUMERIC,
  new_rate_color_duplex NUMERIC
)
RETURNS VOID AS $$
BEGIN
  IF new_rate_bw_simplex < 0 OR new_rate_bw_duplex < 0 OR new_rate_color_simplex < 0 OR new_rate_color_duplex < 0 THEN
    RAISE EXCEPTION 'Rates cannot be negative';
  END IF;

  UPDATE public.shops
  SET 
    rate_bw_simplex = new_rate_bw_simplex,
    rate_bw_duplex = new_rate_bw_duplex,
    rate_color_simplex = new_rate_color_simplex,
    rate_color_duplex = new_rate_color_duplex
  WHERE id = target_shop_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
