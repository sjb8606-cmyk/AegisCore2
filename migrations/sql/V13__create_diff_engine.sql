CREATE TABLE diffs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  entity_type     VARCHAR(100) NOT NULL,
  entity_id       UUID NOT NULL,
  diff_payload    JSONB NOT NULL,
  before_hash     TEXT NOT NULL,
  after_hash      TEXT NOT NULL,
  changed_fields  TEXT[] NOT NULL,
  actor_id        TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Harden with RLS
ALTER TABLE diffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE diffs FORCE ROW LEVEL SECURITY;

CREATE POLICY diff_tenant_isolation ON diffs
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX idx_diffs_lookup ON diffs(tenant_id, entity_type, entity_id);
