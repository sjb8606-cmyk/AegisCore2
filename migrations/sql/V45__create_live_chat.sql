CREATE TABLE IF NOT EXISTS chat_conversations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  user_id           UUID,
  assigned_agent    UUID,
  status            VARCHAR(30) DEFAULT 'open' CHECK (status IN ('open','pending','closed')),
  priority          INTEGER DEFAULT 1,
  tags              TEXT[] DEFAULT '{}',
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  conversation_id   UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  sender_id         UUID,
  sender_type       VARCHAR(20) CHECK (sender_type IN ('user','agent','system')),
  message           TEXT,
  attachments       JSONB DEFAULT '[]',
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_agents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  user_id           UUID NOT NULL,
  name              VARCHAR(255),
  status            VARCHAR(20) DEFAULT 'offline' CHECK (status IN ('online','offline','busy')),
  last_seen         TIMESTAMPTZ DEFAULT NOW(),
  current_load      INTEGER DEFAULT 0
);

-- Row Level Security Activation
ALTER TABLE chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_conversations FORCE ROW LEVEL SECURITY;

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages FORCE ROW LEVEL SECURITY;

ALTER TABLE chat_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_agents FORCE ROW LEVEL SECURITY;

-- Dynamic Tenant Isolation Policies
CREATE POLICY tenant_isolation_conversations ON chat_conversations 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_messages ON chat_messages 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_agents ON chat_agents 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Core Query Optimization Indices
CREATE INDEX IF NOT EXISTS idx_conversations_tenant ON chat_conversations(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON chat_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agents_tenant_status ON chat_agents(tenant_id, status);
