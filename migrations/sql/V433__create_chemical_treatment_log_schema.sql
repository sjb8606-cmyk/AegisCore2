CREATE TABLE chemical_treatment_logs (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  visit_id UUID NOT NULL,
  product_name TEXT NOT NULL,
  quantity_applied NUMERIC NOT NULL CHECK (quantity_applied > 0),
  unit TEXT NOT NULL,
  application_method TEXT NOT NULL,
  target_area TEXT NOT NULL,
  sds_reference_url TEXT,
  warranty_window_days INTEGER NOT NULL DEFAULT 0 CHECK (
    warranty_window_days >= 0
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chemical_treatment_logs_tenant_visit
  ON chemical_treatment_logs (tenant_id, visit_id);

CREATE INDEX idx_chemical_treatment_logs_tenant_product
  ON chemical_treatment_logs (tenant_id, product_name);

ALTER TABLE chemical_treatment_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE chemical_treatment_logs FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_chemical_treatment_logs
  ON chemical_treatment_logs
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
