-- =============================================================================
-- Veridact v1.0 — Migration V1: Base Schema
-- Flyway: V1__base_schema.sql
--
-- All tables include:
--   tenant_id    — enforced via RLS (app.current_tenant())
--   created_at   — immutable insert timestamp
--   deleted_at   — soft-delete for GDPR right-to-erasure
--
-- RLS: every SELECT/INSERT/UPDATE checks tenant_id = app.current_tenant()
--      Deletes are soft only — no physical DELETE ever reaches these tables.
--
-- NOTE: the app.* functions live in a dedicated "app" schema. This schema
-- must exist before those functions can be created — added explicitly here
-- (the original architecture spec omitted this step).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

CREATE SCHEMA IF NOT EXISTS app;

CREATE OR REPLACE FUNCTION app.current_tenant()
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  tid text;
BEGIN
  tid := current_setting('app.current_tenant_id', true);
  IF tid IS NULL OR tid = '' THEN
    RAISE EXCEPTION 'app.current_tenant_id is not set — RLS violation';
  END IF;
  RETURN tid::uuid;
END;
$$;

CREATE TABLE IF NOT EXISTS receipts (
  receipt_id        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID          NOT NULL,
  idempotency_key   VARCHAR(128)  NULL,
  event_type        VARCHAR(64)   NOT NULL DEFAULT 'new_receipt',
  input             JSONB         NOT NULL,
  output            JSONB         NOT NULL DEFAULT '{}',
  rules_version     VARCHAR(64)   NOT NULL,
  rules_hash        CHAR(64)      NOT NULL,
  hash              CHAR(64)      NOT NULL,
  previous_hash     CHAR(64)      NOT NULL,
  replayable        BOOLEAN       NOT NULL DEFAULT true,
  actor             JSONB         NOT NULL,
  context           JSONB         NOT NULL,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ   NULL,

  CONSTRAINT receipts_event_type_check CHECK (event_type = 'new_receipt'),
  CONSTRAINT receipts_rules_hash_format CHECK (rules_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT receipts_hash_format CHECK (hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT receipts_previous_hash_format CHECK (previous_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT receipts_tenant_idempotency_key_unique UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_receipts_tenant_id ON receipts (tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_receipts_created_at ON receipts (tenant_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_receipts_idempotency_key ON receipts (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_receipts_rules_version ON receipts (tenant_id, rules_version) WHERE deleted_at IS NULL;

ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS receipts_tenant_isolation ON receipts;
CREATE POLICY receipts_tenant_isolation ON receipts FOR ALL
  USING (tenant_id = app.current_tenant()) WITH CHECK (tenant_id = app.current_tenant());

DROP RULE IF EXISTS receipts_no_physical_delete ON receipts;
CREATE RULE receipts_no_physical_delete AS ON DELETE TO receipts DO INSTEAD NOTHING;

CREATE TABLE IF NOT EXISTS changes (
  change_id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID          NOT NULL,
  event_type            VARCHAR(64)   NOT NULL,
  actor                 JSONB         NOT NULL,
  action_type            VARCHAR(128)  NOT NULL,
  previous_state_hash    CHAR(64)      NOT NULL,
  new_state_hash          CHAR(64)      NOT NULL,
  diff                    JSONB         NOT NULL DEFAULT '[]',
  linked_receipt          UUID          NULL REFERENCES receipts(receipt_id) ON DELETE RESTRICT,
  created_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  deleted_at                TIMESTAMPTZ   NULL,

  CONSTRAINT changes_event_type_check CHECK (event_type IN ('rule_change', 'manual_override', 'system_update')),
  CONSTRAINT changes_previous_state_hash_format CHECK (previous_state_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT changes_new_state_hash_format CHECK (new_state_hash ~ '^[a-f0-9]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_changes_tenant_id ON changes (tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_changes_created_at ON changes (tenant_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_changes_event_type ON changes (tenant_id, event_type) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_changes_actor_id ON changes ((actor->>'id'), tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_changes_linked_receipt ON changes (linked_receipt) WHERE linked_receipt IS NOT NULL;

ALTER TABLE changes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS changes_tenant_isolation ON changes;
CREATE POLICY changes_tenant_isolation ON changes FOR ALL
  USING (tenant_id = app.current_tenant()) WITH CHECK (tenant_id = app.current_tenant());

DROP RULE IF EXISTS changes_no_physical_delete ON changes;
CREATE RULE changes_no_physical_delete AS ON DELETE TO changes DO INSTEAD NOTHING;

CREATE TABLE IF NOT EXISTS alerts (
  alert_id        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID          NOT NULL,
  event_type      VARCHAR(64)   NOT NULL,
  severity        VARCHAR(16)   NOT NULL,
  message         TEXT          NOT NULL,
  human_message   TEXT          NOT NULL,
  actor           JSONB         NOT NULL,
  linked_receipt  UUID          NULL REFERENCES receipts(receipt_id) ON DELETE RESTRICT,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ   NULL,

  CONSTRAINT alerts_event_type_check CHECK (event_type IN (
    'new_receipt','rule_change','manual_override','system_update',
    'replay_match','replay_mismatch','hash_mismatch'
  )),
  CONSTRAINT alerts_severity_check CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH'))
);

CREATE INDEX IF NOT EXISTS idx_alerts_tenant_id ON alerts (tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON alerts (tenant_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts (tenant_id, severity) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_alerts_event_type ON alerts (tenant_id, event_type) WHERE deleted_at IS NULL;

ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS alerts_tenant_isolation ON alerts;
CREATE POLICY alerts_tenant_isolation ON alerts FOR ALL
  USING (tenant_id = app.current_tenant()) WITH CHECK (tenant_id = app.current_tenant());

DROP RULE IF EXISTS alerts_no_physical_delete ON alerts;
CREATE RULE alerts_no_physical_delete AS ON DELETE TO alerts DO INSTEAD NOTHING;

GRANT USAGE ON SCHEMA app TO veridact_app;
GRANT EXECUTE ON FUNCTION app.current_tenant() TO veridact_app;
GRANT SELECT, INSERT, UPDATE ON receipts, changes, alerts TO veridact_app;
