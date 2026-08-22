CREATE TABLE IF NOT EXISTS availability_subscription (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  user_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  condition TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, user_id, entity_type, entity_id)
);
CREATE TABLE IF NOT EXISTS availability_notification (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  user_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
