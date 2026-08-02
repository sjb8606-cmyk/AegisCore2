CREATE TABLE team_chat_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  user_id       UUID NOT NULL,
  channel       VARCHAR(150) NOT NULL,
  body          TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 10000),
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  deleted_at    TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_team_chat_messages_tenant_channel ON team_chat_messages(tenant_id, channel, created_at DESC);

ALTER TABLE team_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_chat_messages FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_team_chat_messages ON team_chat_messages
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
