CREATE TABLE IF NOT EXISTS franchise_royalties (
  royalty_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  franchisee_location_id UUID NOT NULL,
  reporting_period TEXT NOT NULL,
  gross_revenue_reported NUMERIC(14,2) NOT NULL,
  royalty_percentage NUMERIC(7,4) NOT NULL,
  royalty_amount_due NUMERIC(14,2) NOT NULL,
  payment_status TEXT NOT NULL CHECK (
    payment_status IN (
      'pending',
      'paid',
      'overdue'
    )
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE franchise_royalties ENABLE ROW LEVEL SECURITY;
ALTER TABLE franchise_royalties FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_franchise_royalties
  ON franchise_royalties
  USING (
    tenant_id = current_setting('app.tenant_id')::uuid
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id')::uuid
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_franchise_royalty_period
  ON franchise_royalties (
    tenant_id,
    franchisee_location_id,
    reporting_period
  );

CREATE INDEX IF NOT EXISTS idx_franchise_royalties_location
  ON franchise_royalties (
    tenant_id,
    franchisee_location_id
  );

CREATE INDEX IF NOT EXISTS idx_franchise_royalties_status
  ON franchise_royalties (
    tenant_id,
    payment_status
  );
