CREATE TABLE IF NOT EXISTS staff_license (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  staff_id UUID NOT NULL,
  license_type TEXT NOT NULL,
  license_number TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_staff_license_staff
  ON staff_license(tenant_id, staff_id, active);
CREATE INDEX IF NOT EXISTS idx_staff_license_expiry
  ON staff_license(tenant_id, expires_at)
  WHERE active = true;
