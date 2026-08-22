CREATE TABLE IF NOT EXISTS point_transaction (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  user_id TEXT NOT NULL,
  points NUMERIC NOT NULL,
  type TEXT NOT NULL,
  reason TEXT NOT NULL,
  related_id TEXT,
  balance_after NUMERIC NOT NULL,
  ts TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_points_user
  ON point_transaction(tenant_id, user_id, ts);
