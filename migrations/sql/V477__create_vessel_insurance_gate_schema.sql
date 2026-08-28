CREATE TABLE IF NOT EXISTS marina_vessel_coi (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  vessel_id TEXT NOT NULL,
  carrier TEXT NOT NULL,
  policy_number TEXT NOT NULL,
  liability_cents BIGINT NOT NULL,
  effective_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  document_ref TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_marina_coi_vessel
  ON marina_vessel_coi(tenant_id, vessel_id, active);
CREATE INDEX IF NOT EXISTS idx_marina_coi_expiry
  ON marina_vessel_coi(tenant_id, expires_at)
  WHERE active = true;
