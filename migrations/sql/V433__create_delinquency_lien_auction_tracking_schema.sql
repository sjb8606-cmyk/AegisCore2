CREATE TABLE IF NOT EXISTS storage_delinquency (
  delinquency_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  tenant_holder_id UUID NOT NULL,
  unit_id UUID NOT NULL,
  days_overdue INTEGER NOT NULL CHECK (days_overdue > 0),
  lien_filed_date TIMESTAMPTZ,
  auction_scheduled_date TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (
    status IN (
      'current',
      'late',
      'lien_filed',
      'auction_scheduled',
      'resolved'
    )
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE storage_delinquency ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage_delinquency FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_storage_delinquency
  ON storage_delinquency
  USING (
    tenant_id = current_setting('app.tenant_id')::uuid
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id')::uuid
  );

CREATE INDEX IF NOT EXISTS idx_storage_delinquency_tenant_holder
  ON storage_delinquency (
    tenant_id,
    tenant_holder_id
  );

CREATE INDEX IF NOT EXISTS idx_storage_delinquency_tenant_unit
  ON storage_delinquency (
    tenant_id,
    unit_id
  );

CREATE INDEX IF NOT EXISTS idx_storage_delinquency_status
  ON storage_delinquency (
    tenant_id,
    status
  );
