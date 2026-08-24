CREATE TABLE IF NOT EXISTS rest_86_board (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  menu_item_id UUID NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  until_at TIMESTAMPTZ,
  actor_id TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_rest_86_item
  ON rest_86_board(tenant_id, menu_item_id);
CREATE INDEX IF NOT EXISTS idx_rest_86_status
  ON rest_86_board(tenant_id, status);
