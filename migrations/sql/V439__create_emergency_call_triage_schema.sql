CREATE TABLE emergency_call_triage (
  call_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  client_id UUID NOT NULL,
  property_id UUID NOT NULL,
  severity TEXT NOT NULL CHECK (
    severity IN (
      'minor_drip',
      'active_leak',
      'burst_pipe',
      'no_water',
      'sewage_backup'
    )
  ),
  water_shutoff_location TEXT,
  estimated_response_time_minutes INTEGER NOT NULL
    CHECK (estimated_response_time_minutes >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_emergency_call_triage_tenant_property
  ON emergency_call_triage (
    tenant_id,
    property_id
  );

CREATE INDEX idx_emergency_call_triage_tenant_severity
  ON emergency_call_triage (
    tenant_id,
    severity
  );

ALTER TABLE emergency_call_triage
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE emergency_call_triage
  FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_emergency_call_triage
  ON emergency_call_triage
  USING (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  )
  WITH CHECK (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  );
