CREATE TABLE warranty_claim (
  claim_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  job_id UUID NOT NULL,
  equipment_id UUID NOT NULL,
  issue_description TEXT NOT NULL,
  manufacturer_warranty_status TEXT NOT NULL CHECK (
    manufacturer_warranty_status IN (
      'active',
      'expired',
      'unknown'
    )
  ),
  claim_status TEXT NOT NULL CHECK (
    claim_status IN (
      'filed',
      'approved',
      'denied',
      'resolved'
    )
  ),
  resolution_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_warranty_claim_tenant_job
  ON warranty_claim (
    tenant_id,
    job_id
  );

CREATE INDEX idx_warranty_claim_tenant_equipment
  ON warranty_claim (
    tenant_id,
    equipment_id
  );

CREATE INDEX idx_warranty_claim_tenant_status
  ON warranty_claim (
    tenant_id,
    claim_status
  );

ALTER TABLE warranty_claim
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE warranty_claim
  FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_warranty_claim
  ON warranty_claim
  USING (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  )
  WITH CHECK (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  );
