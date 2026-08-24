CREATE TABLE electrical_panel_circuit_inventory (
  panel_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  property_id UUID NOT NULL,
  panel_amperage INTEGER NOT NULL
    CHECK (panel_amperage > 0),
  code_compliance_version TEXT NOT NULL,
  circuits JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_electrical_panel_tenant_property
  ON electrical_panel_circuit_inventory (
    tenant_id,
    property_id
  );

ALTER TABLE electrical_panel_circuit_inventory
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE electrical_panel_circuit_inventory
  FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_electrical_panel_circuit_inventory
  ON electrical_panel_circuit_inventory
  USING (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  )
  WITH CHECK (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  );
