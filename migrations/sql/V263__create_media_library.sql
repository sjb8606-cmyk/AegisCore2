CREATE TABLE media_assets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  user_id       UUID NOT NULL,
  file_url      TEXT NOT NULL,
  file_type     VARCHAR(50) NOT NULL,
  file_size_bytes BIGINT CHECK (file_size_bytes >= 0),
  tags          JSONB NOT NULL DEFAULT '[]',
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_media_assets_tenant_user ON media_assets(tenant_id, user_id, created_at DESC);

ALTER TABLE media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_assets FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_media_assets ON media_assets
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
