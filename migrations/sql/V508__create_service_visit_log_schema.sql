CREATE TABLE service_visit_logs (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  visit_id UUID NOT NULL,
  contract_id UUID NOT NULL,
  technician_id UUID NOT NULL,
  arrival_timestamp TIMESTAMPTZ,
  departure_timestamp TIMESTAMPTZ,
  notes TEXT NOT NULL DEFAULT '',
  photos JSONB NOT NULL DEFAULT '{"before":[],"after":[]}'::jsonb,
  checklist_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uq_service_visit_logs_tenant_visit
  ON service_visit_logs (tenant_id, visit_id);

CREATE INDEX idx_service_visit_logs_tenant_contract
  ON service_visit_logs (tenant_id, contract_id);

CREATE INDEX idx_service_visit_logs_tenant_technician
  ON service_visit_logs (tenant_id, technician_id);

ALTER TABLE service_visit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_visit_logs FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_service_visit_logs
  ON service_visit_logs
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
