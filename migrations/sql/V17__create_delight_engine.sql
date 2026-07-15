CREATE TABLE conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  persona_id      TEXT NOT NULL,
  role            VARCHAR(20) NOT NULL, -- 'user' or 'assistant'
  content         TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE user_context (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  persona_id      TEXT NOT NULL,
  key             TEXT NOT NULL,
  value           TEXT NOT NULL,
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Harden with RLS
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_context ENABLE ROW LEVEL SECURITY;

CREATE POLICY conv_isolation ON conversations
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY ctx_isolation ON user_context
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
