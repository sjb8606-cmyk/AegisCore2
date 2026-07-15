-- infra/docker/init-db.sql
-- Runs once on first Postgres container start (dev only).
-- Production schema is managed by Flyway migrations.

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create app role with limited privileges (no superuser)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'platform_app') THEN
    CREATE ROLE platform_app LOGIN PASSWORD 'changeme_app';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE platform_core TO platform_app;
