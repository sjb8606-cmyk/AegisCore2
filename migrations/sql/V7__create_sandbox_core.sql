CREATE TABLE sandbox_sessions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  actor_id          TEXT NOT NULL,
  sandbox_tenant_id UUID NOT NULL UNIQUE,
  status            VARCHAR(30) DEFAULT 'active',
  token_budget      INTEGER NOT NULL,
  tokens_used       INTEGER DEFAULT 0,
  expires_at        TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Harden with RLS (Universal Spec v3.6)
ALTER TABLE sandbox_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sandbox_sessions FORCE ROW LEVEL SECURITY;

CREATE POLICY sandbox_tenant_isolation ON sandbox_sessions
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
