-- Phase 1: record how a customer selected the shop.
-- Values are server-normalized and never used as authorization.

BEGIN;

ALTER TABLE autoprint_v3.orders
  ADD COLUMN IF NOT EXISTS submission_channel text NOT NULL DEFAULT 'qr';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'orders_submission_channel_check'
      AND conrelid = 'autoprint_v3.orders'::regclass
  ) THEN
    ALTER TABLE autoprint_v3.orders
      ADD CONSTRAINT orders_submission_channel_check
      CHECK (submission_channel IN ('qr', 'shop_code', 'saved_shop'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_orders_submission_channel
  ON autoprint_v3.orders (shop_id, submission_channel, created_at DESC);

NOTIFY pgrst, 'reload schema';

COMMIT;
