CREATE TABLE IF NOT EXISTS hr_policy_version (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  policy_key TEXT NOT NULL,
  version TEXT NOT NULL,
  title TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  required BOOLEAN NOT NULL DEFAULT true,
  active BOOLEAN NOT NULL DEFAULT true,
  effective_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_hr_policy_ver
  ON hr_policy_version(tenant_id, policy_key, version);
CREATE TABLE IF NOT EXISTS hr_policy_ack (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  employee_id TEXT NOT NULL,
  policy_version_id UUID NOT NULL,
  policy_key TEXT NOT NULL,
  version TEXT NOT NULL,
  acked_at TIMESTAMPTZ NOT NULL,
  actor_id TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_hr_policy_ack
  ON hr_policy_ack(tenant_id, employee_id, policy_version_id);
