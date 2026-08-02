-- Cardholder-data-environment access log — records WHO looked at
-- cardholder data and WHY, never the cardholder data itself.
CREATE TABLE cde_access_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  accessor_id    UUID NOT NULL,
  resource_ref   VARCHAR(255) NOT NULL,
  access_reason  VARCHAR(255) NOT NULL,
  accessed_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_cde_access_logs_tenant_resource ON cde_access_logs(tenant_id, resource_ref, accessed_at DESC);

ALTER TABLE cde_access_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE cde_access_logs FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_cde_access_logs ON cde_access_logs
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
