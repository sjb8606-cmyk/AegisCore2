CREATE TABLE IF NOT EXISTS fit_membership (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  member_id UUID NOT NULL,
  plan_id TEXT NOT NULL,
  status TEXT NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ,
  cancel_at TIMESTAMPTZ,
  freeze_periods JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_fit_membership_member
  ON fit_membership(tenant_id, member_id, status);
