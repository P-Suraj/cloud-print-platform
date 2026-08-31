-- Optional customer-facing label for identifying a print order in the shop queue.
BEGIN;

ALTER TABLE autoprint_v3.orders
  ADD COLUMN IF NOT EXISTS customer_job_name text;

ALTER TABLE autoprint_v3.orders
  DROP CONSTRAINT IF EXISTS orders_customer_job_name_length;

ALTER TABLE autoprint_v3.orders
  ADD CONSTRAINT orders_customer_job_name_length
  CHECK (customer_job_name IS NULL OR (char_length(btrim(customer_job_name)) BETWEEN 1 AND 80));

COMMIT;
