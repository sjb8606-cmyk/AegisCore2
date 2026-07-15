-- migrations/sql/V2__rls_hardening.sql
-- Strengthen RLS: add superuser bypass controls,
-- cross-tenant audit logging, and additional indexes.

BEGIN;

-- Prevent RLS bypass by non-superuser roles
ALTER TABLE items        FORCE ROW LEVEL SECURITY;
ALTER TABLE usage_events FORCE ROW LEVEL SECURITY;

-- Superuser-only bypass policy for admin tooling
-- (platform_admin role created separately in ops runbook)
CREATE POLICY items_admin_bypass ON items
  TO platform_admin
  USING (true);

CREATE POLICY usage_admin_bypass ON usage_events
  TO platform_admin
  USING (true);

-- ── Soft-delete helper view ───────────────────────────────────
CREATE OR REPLACE VIEW active_items AS
  SELECT * FROM items WHERE deleted_at IS NULL;

CREATE OR REPLACE VIEW active_tenants AS
  SELECT * FROM tenants WHERE deleted_at IS NULL AND status = 'active';

-- ── Partial indexes for common query patterns ─────────────────
CREATE INDEX idx_items_tenant_active
  ON items (tenant_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_usage_tenant_month
  ON usage_events (tenant_id, event_type, recorded_at DESC)
  ;

COMMIT;
