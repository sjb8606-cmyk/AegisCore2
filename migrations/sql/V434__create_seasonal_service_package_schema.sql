CREATE TABLE seasonal_service_packages (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  included_visits INTEGER NOT NULL CHECK (included_visits > 0),
  visits_used INTEGER NOT NULL DEFAULT 0 CHECK (visits_used >= 0),
  expiry_date TIMESTAMPTZ NOT NULL,
  upsell_threshold INTEGER NOT NULL DEFAULT 3 CHECK (
    upsell_threshold >= 0
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT seasonal_service_package_visits_valid
    CHECK (visits_used <= included_visits)
);

CREATE INDEX idx_seasonal_service_packages_tenant_expiry
  ON seasonal_service_packages (tenant_id, expiry_date);

ALTER TABLE seasonal_service_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE seasonal_service_packages FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_seasonal_service_packages
  ON seasonal_service_packages
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
