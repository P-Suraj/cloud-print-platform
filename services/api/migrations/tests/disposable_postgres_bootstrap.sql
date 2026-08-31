-- Disposable PostgreSQL-only bootstrap for migration verification.
-- This is deliberately NOT a production/Supabase bootstrap. It supplies only
-- the legacy, auth and storage contracts required to apply v3 migrations.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN CREATE ROLE authenticator NOLOGIN; END IF;
END $$;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS public.shops (
  id uuid PRIMARY KEY,
  shop_code text NOT NULL UNIQUE,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.print_jobs (id uuid PRIMARY KEY);

CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  public boolean NOT NULL DEFAULT false,
  avif_autodetection boolean,
  file_size_limit bigint,
  allowed_mime_types text[]
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text NOT NULL REFERENCES storage.buckets(id),
  name text NOT NULL
);

INSERT INTO public.shops (id, shop_code, name, is_active)
VALUES ('c0a80001-0000-0000-0000-000000000001', 'CANARY01', 'Disposable Canary Shop', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email)
VALUES ('c0a80001-0000-0000-0000-000000000002', 'canary-owner@example.test')
ON CONFLICT (id) DO NOTHING;
