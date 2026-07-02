-- Create shop_secrets table to store shopkeeper PINs securely out of public RLS reach
CREATE TABLE IF NOT EXISTS public.shop_secrets (
    shop_id UUID PRIMARY KEY REFERENCES public.shops(id) ON DELETE CASCADE,
    pin TEXT NOT NULL DEFAULT '1234'
);

-- Enable RLS on shop_secrets but create no policies, so public anon users cannot query or modify it
ALTER TABLE public.shop_secrets ENABLE ROW LEVEL SECURITY;

-- Populate shop_secrets for all existing shops with a default PIN '1234'
INSERT INTO public.shop_secrets (shop_id, pin)
SELECT id, '1234' FROM public.shops
ON CONFLICT DO NOTHING;

-- Create secure RPC function to verify shop PIN (SECURITY DEFINER bypasses RLS securely)
CREATE OR REPLACE FUNCTION public.verify_shop_pin(target_shop_id UUID, input_pin TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  valid BOOLEAN;
BEGIN
  SELECT (pin = input_pin) INTO valid
  FROM public.shop_secrets
  WHERE shop_id = target_shop_id;
  RETURN COALESCE(valid, FALSE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
