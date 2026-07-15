CREATE TABLE document_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  entity_type     VARCHAR(100) NOT NULL,
  entity_id       UUID NOT NULL,
  version         INTEGER NOT NULL,
  payload         JSONB NOT NULL,
  content_hash    TEXT NOT NULL,
  actor_id        TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Harden with RLS
ALTER TABLE document_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_snapshots FORCE ROW LEVEL SECURITY;

CREATE POLICY snapshot_tenant_isolation ON document_snapshots
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Ensure we can't have two "Version 1s" for the same entity
CREATE UNIQUE INDEX idx_snapshot_version ON document_snapshots(tenant_id, entity_type, entity_id, version);
