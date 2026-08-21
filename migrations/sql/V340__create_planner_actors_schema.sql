CREATE TABLE IF NOT EXISTS planner_actors (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  niche TEXT NOT NULL,
  role TEXT NOT NULL,
  display_name TEXT NOT NULL,
  reliability_score NUMERIC NOT NULL DEFAULT 0.7,
  availability JSONB NOT NULL DEFAULT '[]',
  contact_meta JSONB NOT NULL DEFAULT '{}',
  tags TEXT[] NOT NULL DEFAULT '{}',
  csr_partner_id UUID,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_planner_actors_tenant_niche
  ON planner_actors(tenant_id, niche, active);
