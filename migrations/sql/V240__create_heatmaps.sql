CREATE TABLE heatmap_snapshots (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL,
  user_id      UUID NOT NULL,
  page_url     TEXT NOT NULL,
  click_data   JSONB NOT NULL DEFAULT '[]',
  captured_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_heatmap_snapshots_tenant_page ON heatmap_snapshots(tenant_id, page_url, created_at DESC);

ALTER TABLE heatmap_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE heatmap_snapshots FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_heatmap_snapshots ON heatmap_snapshots
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
