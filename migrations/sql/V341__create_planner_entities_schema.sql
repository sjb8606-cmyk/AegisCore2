CREATE TABLE IF NOT EXISTS planner_entities (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  niche TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available',
  tags TEXT[] NOT NULL DEFAULT '{}',
  custom_fields JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_planner_entities_tenant
  ON planner_entities(tenant_id, niche, status);
