DROP TABLE IF EXISTS pm_rent_payments CASCADE;
DROP TABLE IF EXISTS pm_leases CASCADE;
DROP TABLE IF EXISTS pm_tenants CASCADE;
DROP TABLE IF EXISTS pm_units CASCADE;
DROP TABLE IF EXISTS pm_properties CASCADE;

CREATE TABLE pm_properties (
  id           UUID PRIMARY KEY,
  tenant_id    UUID NOT NULL,
  name         VARCHAR(255) NOT NULL,
  address      TEXT NOT NULL,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE pm_units (
  id             UUID PRIMARY KEY,
  tenant_id      UUID NOT NULL,
  property_id    UUID NOT NULL REFERENCES pm_properties(id) ON DELETE CASCADE,
  unit_number    VARCHAR(50) NOT NULL,
  status         VARCHAR(50) NOT NULL DEFAULT 'vacant' CHECK (status IN ('vacant', 'occupied', 'maintenance')),
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(property_id, unit_number)
);

CREATE TABLE pm_tenants (
  id           UUID PRIMARY KEY,
  tenant_id    UUID NOT NULL,
  name         VARCHAR(255) NOT NULL,
  email        VARCHAR(255) NOT NULL,
  phone        VARCHAR(50),
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE pm_leases (
  id                  UUID PRIMARY KEY,
  tenant_id           UUID NOT NULL,
  unit_id             UUID NOT NULL REFERENCES pm_units(id),
  tenant_profile_id   UUID NOT NULL REFERENCES pm_tenants(id),
  start_date          DATE NOT NULL,
  end_date            DATE,
  rent_amount_cents   BIGINT NOT NULL,
  deposit_amount_cents BIGINT DEFAULT 0,
  status              VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'terminated', 'expired')),
  created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE pm_rent_payments (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  lease_id        UUID NOT NULL REFERENCES pm_leases(id) ON DELETE CASCADE,
  amount_cents    BIGINT NOT NULL,
  payment_date    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  receipt_number  VARCHAR(100) NOT NULL UNIQUE
);

ALTER TABLE pm_properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE pm_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE pm_tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE pm_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE pm_rent_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_props ON pm_properties USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_units ON pm_units USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_tenants_pm ON pm_tenants USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_leases ON pm_leases USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_rents ON pm_rent_payments USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_pm_units_prop_status ON pm_units(property_id, status);
CREATE INDEX IF NOT EXISTS idx_pm_leases_unit ON pm_leases(unit_id, status);
CREATE INDEX IF NOT EXISTS idx_pm_rents_lease ON pm_rent_payments(lease_id);
