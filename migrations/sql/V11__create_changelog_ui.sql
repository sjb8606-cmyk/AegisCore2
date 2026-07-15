CREATE TABLE change_log_views (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  entity_type     VARCHAR(100) NOT NULL,
  entity_id       UUID NOT NULL,
  actor_id        TEXT NOT NULL,
  viewed_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Harden with RLS
ALTER TABLE change_log_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE change_log_views FORCE ROW LEVEL SECURITY;

CREATE POLICY changelog_tenant_isolation ON change_log_views
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
