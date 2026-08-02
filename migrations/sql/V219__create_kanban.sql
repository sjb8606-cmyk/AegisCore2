CREATE TABLE kanban_cards (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL,
  user_id      UUID NOT NULL,
  board_name   VARCHAR(255) NOT NULL,
  column_name  VARCHAR(100) NOT NULL DEFAULT 'todo',
  title        VARCHAR(255) NOT NULL,
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_kanban_cards_tenant_board ON kanban_cards(tenant_id, board_name, column_name, position);

ALTER TABLE kanban_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE kanban_cards FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_kanban_cards ON kanban_cards
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
