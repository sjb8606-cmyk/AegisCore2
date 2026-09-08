CREATE TABLE recurring_route_contracts (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  contract_id UUID NOT NULL,
  frequency TEXT NOT NULL CHECK (
    frequency IN ('weekly', 'biweekly', 'monthly', 'seasonal')
  ),
  next_visit_date TIMESTAMPTZ NOT NULL,
  route_group_id UUID,
  status TEXT NOT NULL CHECK (
    status IN ('active', 'paused', 'cancelled')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uq_recurring_route_contract_tenant_contract
  ON recurring_route_contracts (tenant_id, contract_id);

CREATE INDEX idx_recurring_route_contracts_tenant
  ON recurring_route_contracts (tenant_id);

ALTER TABLE recurring_route_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_route_contracts FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_recurring_route_contracts
  ON recurring_route_contracts
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE TABLE recurring_route_visits (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  contract_id UUID NOT NULL,
  scheduled_date TIMESTAMPTZ NOT NULL,
  route_order INTEGER,
  status TEXT NOT NULL CHECK (
    status IN ('scheduled', 'skipped', 'completed')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_recurring_route_visits_tenant_date
  ON recurring_route_visits (tenant_id, scheduled_date);

CREATE INDEX idx_recurring_route_visits_tenant_contract
  ON recurring_route_visits (tenant_id, contract_id);

ALTER TABLE recurring_route_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_route_visits FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_recurring_route_visits
  ON recurring_route_visits
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
