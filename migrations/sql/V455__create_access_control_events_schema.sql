CREATE TABLE IF NOT EXISTS fit_access_event (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  member_id TEXT NOT NULL,
  location TEXT NOT NULL,
  result TEXT NOT NULL,
  reason TEXT,
  device_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_fit_access_member
  ON fit_access_event(tenant_id, member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fit_access_result
  ON fit_access_event(tenant_id, result, created_at DESC);
