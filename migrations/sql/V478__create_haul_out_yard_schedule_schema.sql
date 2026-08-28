CREATE TABLE IF NOT EXISTS marina_yard_block (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  label TEXT NOT NULL,
  occupied_by_job_id UUID,
  vessel_id TEXT
);
CREATE TABLE IF NOT EXISTS marina_haul_job (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  vessel_id TEXT NOT NULL,
  job_type TEXT NOT NULL,
  lift_start TIMESTAMPTZ NOT NULL,
  lift_end TIMESTAMPTZ NOT NULL,
  yard_block_id UUID,
  status TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_marina_haul_lift
  ON marina_haul_job(tenant_id, lift_start, status);
