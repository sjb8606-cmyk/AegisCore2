-- migrations/sql/V1__init.sql
-- Initial schema: tenants, RLS policies, audit, metering, items (demo)
-- Flyway migration — transactional DDL

BEGIN;

-- ── Extensions ────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Tenants ───────────────────────────────────────────────────
CREATE TABLE tenants (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug         TEXT        NOT NULL UNIQUE,
  name         TEXT        NOT NULL,
  plan         TEXT        NOT NULL DEFAULT 'free',
  status       TEXT        NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active','suspended','deleted')),
  metadata     JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ                          -- soft-delete (GDPR)
);

CREATE INDEX idx_tenants_slug       ON tenants (slug);
CREATE INDEX idx_tenants_status     ON tenants (status);
CREATE INDEX idx_tenants_deleted_at ON tenants (deleted_at) WHERE deleted_at IS NULL;

-- ── Items (demo tenant-scoped table) ──────────────────────────
CREATE TABLE items (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID        NOT NULL REFERENCES tenants (id),
  name        TEXT        NOT NULL,
  description TEXT,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);

CREATE INDEX idx_items_tenant_id  ON items (tenant_id);
CREATE INDEX idx_items_deleted_at ON items (deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_items_created_at ON items (created_at DESC);

-- ── Usage Events (metering) ────────────────────────────────────
CREATE TABLE usage_events (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID        NOT NULL REFERENCES tenants (id),
  actor_id         TEXT,
  event_type       TEXT        NOT NULL,
  quantity         NUMERIC     NOT NULL CHECK (quantity > 0),
  unit             TEXT        NOT NULL DEFAULT 'count',
  idempotency_key  TEXT        NOT NULL UNIQUE,          -- idempotency
  resource_id      TEXT,
  metadata         JSONB,
  recorded_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_usage_tenant_id    ON usage_events (tenant_id, recorded_at DESC);
CREATE INDEX idx_usage_event_type   ON usage_events (tenant_id, event_type);
CREATE INDEX idx_usage_idempotency  ON usage_events (idempotency_key);

-- ── Audit chain state (last hash per tenant) ───────────────────
-- Stored in Redis for performance; this table is the durable backup.
CREATE TABLE audit_chain_state (
  tenant_id    UUID        PRIMARY KEY REFERENCES tenants (id),
  last_hash    TEXT        NOT NULL,
  last_seq     BIGINT      NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Updated-at trigger ────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_tenants_updated_at
  BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_items_updated_at
  BEFORE UPDATE ON items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Row-Level Security ────────────────────────────────────────
-- The session variable app.current_tenant_id is set by the app
-- before every query (see platform/tenancy/src/rls.ts).

ALTER TABLE items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;

-- Items policy: tenant can only see their own rows
CREATE POLICY items_tenant_isolation ON items
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Usage events policy
CREATE POLICY usage_tenant_isolation ON usage_events
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Grant app role access ──────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'platform_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO platform_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO platform_app;
  END IF;
END
$$;

COMMIT;
