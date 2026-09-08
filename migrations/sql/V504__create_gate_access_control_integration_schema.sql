CREATE TABLE IF NOT EXISTS gate_access_records (
  access_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  tenant_holder_id UUID NOT NULL,
  unit_id UUID NOT NULL,
  access_code TEXT NOT NULL,
  access_status TEXT NOT NULL CHECK (
    access_status IN (
      'active',
      'suspended_nonpayment',
      'revoked'
    )
  ),
  last_entry_timestamp TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE gate_access_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE gate_access_records FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_gate_access_records
  ON gate_access_records
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE TABLE IF NOT EXISTS gate_entry_events (
  event_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  tenant_holder_id UUID NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL
);

ALTER TABLE gate_entry_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE gate_entry_events FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_gate_entry_events
  ON gate_entry_events
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE INDEX IF NOT EXISTS idx_gate_access_tenant_holder
  ON gate_access_records (tenant_id, tenant_holder_id);

CREATE INDEX IF NOT EXISTS idx_gate_access_tenant_unit
  ON gate_access_records (tenant_id, unit_id);

CREATE INDEX IF NOT EXISTS idx_gate_entry_events_tenant_holder
  ON gate_entry_events (tenant_id, tenant_holder_id);
