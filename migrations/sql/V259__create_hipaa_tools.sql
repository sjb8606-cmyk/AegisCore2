-- PHI access log — a real audit trail of who accessed which patient's
-- data and why, distinct from platform/healthcare's own domain logic.
CREATE TABLE phi_access_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  accessor_id     UUID NOT NULL,
  patient_ref     VARCHAR(255) NOT NULL,
  access_reason   VARCHAR(255) NOT NULL,
  accessed_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_phi_access_logs_tenant_patient ON phi_access_logs(tenant_id, patient_ref, accessed_at DESC);
CREATE INDEX idx_phi_access_logs_tenant_accessor ON phi_access_logs(tenant_id, accessor_id, accessed_at DESC);

ALTER TABLE phi_access_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE phi_access_logs FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_phi_access_logs ON phi_access_logs
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
