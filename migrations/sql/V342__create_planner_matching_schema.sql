CREATE TABLE IF NOT EXISTS planner_shifts (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  niche TEXT NOT NULL,
  actor_id UUID NOT NULL,
  entity_id UUID NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL,
  contract_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_planner_shifts_tenant
  ON planner_shifts(tenant_id, niche, status);
CREATE INDEX IF NOT EXISTS idx_planner_shifts_actor
  ON planner_shifts(actor_id, start_time);
