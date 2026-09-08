CREATE TABLE maintenance_agreement (
  agreement_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  client_id UUID NOT NULL,
  equipment_covered JSONB NOT NULL DEFAULT '[]'::jsonb,
  visits_per_year INTEGER NOT NULL CHECK (
    visits_per_year > 0
  ),
  visits_completed_this_cycle INTEGER NOT NULL DEFAULT 0 CHECK (
    visits_completed_this_cycle >= 0
    AND visits_completed_this_cycle <= visits_per_year
  ),
  renewal_date TIMESTAMPTZ NOT NULL,
  priority_response BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_maintenance_agreement_tenant_client
  ON maintenance_agreement (
    tenant_id,
    client_id
  );

CREATE INDEX idx_maintenance_agreement_tenant_renewal
  ON maintenance_agreement (
    tenant_id,
    renewal_date
  );

ALTER TABLE maintenance_agreement
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE maintenance_agreement
  FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_maintenance_agreement
  ON maintenance_agreement
  USING (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  )
  WITH CHECK (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  );
