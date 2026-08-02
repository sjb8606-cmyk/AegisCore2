CREATE TABLE image_edit_presets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  user_id       UUID NOT NULL,
  name          VARCHAR(255) NOT NULL,
  operations    JSONB NOT NULL DEFAULT '[]',
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_image_edit_presets_tenant_user ON image_edit_presets(tenant_id, user_id, created_at DESC);

ALTER TABLE image_edit_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE image_edit_presets FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_image_edit_presets ON image_edit_presets
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
