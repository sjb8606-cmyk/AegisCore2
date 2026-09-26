-- AegisCore Integration / Capability infrastructure
-- Global provider health is platform state, not tenant data.
CREATE TABLE IF NOT EXISTS integration_provider_health (
  provider_id TEXT PRIMARY KEY,
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  consecutive_successes INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_successes >= 0),
  opened_until TIMESTAMPTZ NULL,
  last_failure_at TIMESTAMPTZ NULL,
  last_success_at TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS integration_idempotency (
  tenant_id UUID NOT NULL,
  idempotency_key TEXT NOT NULL,
  capability TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed', 'failed')),
  provider_id TEXT NULL,
  result JSONB NULL,
  error JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS integration_idempotency_capability_idx
  ON integration_idempotency (tenant_id, capability, created_at DESC);
