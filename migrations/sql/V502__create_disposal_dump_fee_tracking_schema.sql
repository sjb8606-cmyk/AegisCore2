CREATE TABLE disposal_dump_fee_tracking (
  disposal_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  job_id UUID NOT NULL,
  disposal_site TEXT NOT NULL,
  waste_category TEXT NOT NULL
    CHECK (
      waste_category IN (
        'general',
        'electronics',
        'hazardous',
        'recyclable',
        'donation'
      )
    ),
  fee_amount NUMERIC(12, 2) NOT NULL
    CHECK (fee_amount >= 0),
  weight_or_volume NUMERIC(12, 3) NOT NULL
    CHECK (weight_or_volume >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_disposal_dump_fee_tracking_tenant_job
  ON disposal_dump_fee_tracking (
    tenant_id,
    job_id
  );

CREATE INDEX idx_disposal_dump_fee_tracking_category
  ON disposal_dump_fee_tracking (
    tenant_id,
    waste_category
  );

ALTER TABLE disposal_dump_fee_tracking
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE disposal_dump_fee_tracking
  FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_disposal_dump_fee_tracking
  ON disposal_dump_fee_tracking
  USING (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  )
  WITH CHECK (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  );
