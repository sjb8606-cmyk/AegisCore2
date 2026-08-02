CREATE TABLE custom_permission_grants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  granted_by    UUID NOT NULL,
  grantee_id    UUID NOT NULL,
  resource_type VARCHAR(100) NOT NULL,
  resource_id   UUID,
  permission    VARCHAR(50) NOT NULL,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  revoked_at    TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_custom_permission_grants_tenant_grantee ON custom_permission_grants(tenant_id, grantee_id, created_at DESC);

ALTER TABLE custom_permission_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_permission_grants FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_custom_permission_grants ON custom_permission_grants
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
