CREATE TABLE IF NOT EXISTS workflow_def (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  entity_type TEXT NOT NULL,
  states JSONB NOT NULL,
  initial_state TEXT NOT NULL,
  transitions JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, entity_type)
);
CREATE TABLE IF NOT EXISTS entity_state (
  tenant_id UUID NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  current_state TEXT NOT NULL,
  history JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, entity_type, entity_id)
);
