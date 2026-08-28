CREATE TABLE IF NOT EXISTS rest_health_log (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  kind TEXT NOT NULL,
  location_label TEXT NOT NULL,
  value NUMERIC NOT NULL,
  unit TEXT NOT NULL,
  in_range BOOLEAN NOT NULL,
  corrective_action TEXT,
  corrected BOOLEAN NOT NULL DEFAULT false,
  actor_id TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_health_log_tenant_time
  ON rest_health_log(tenant_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_health_log_open
  ON rest_health_log(tenant_id, in_range, corrected);
