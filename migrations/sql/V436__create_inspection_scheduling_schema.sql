CREATE TABLE inspection_scheduling (
  inspection_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  permit_id UUID NOT NULL,
  inspector_name TEXT NOT NULL,
  scheduled_date TIMESTAMPTZ NOT NULL,
  result TEXT NOT NULL CHECK (
    result IN (
      'pending',
      'passed',
      'failed',
      'rescheduled'
    )
  ),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_inspection_scheduling_tenant_date
  ON inspection_scheduling (
    tenant_id,
    scheduled_date
  );

CREATE INDEX idx_inspection_scheduling_tenant_permit
  ON inspection_scheduling (
    tenant_id,
    permit_id
  );

ALTER TABLE inspection_scheduling
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE inspection_scheduling
  FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_inspection_scheduling
  ON inspection_scheduling
  USING (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  )
  WITH CHECK (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  );
