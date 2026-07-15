-- Idempotency guards to clear any half-applied schema state
DROP TABLE IF EXISTS tenant_invitations CASCADE;
DROP TABLE IF EXISTS tenant_users CASCADE;

CREATE TABLE tenant_users (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  user_id         UUID NOT NULL,
  role            VARCHAR(50) NOT NULL CHECK (role IN ('admin','member','viewer')),
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, user_id)
);

CREATE TABLE tenant_invitations (
  id            UUID PRIMARY KEY,
  tenant_id     UUID NOT NULL,
  email         VARCHAR(255) NOT NULL,
  role          VARCHAR(50) DEFAULT 'member',
  token         VARCHAR(64) NOT NULL,
  invited_by    UUID,
  expires_at    TIMESTAMP WITH TIME ZONE NOT NULL,
  status        VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','accepted','expired','canceled')),
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE tenant_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_users ON tenant_users USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_invitations ON tenant_invitations USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_tenant_users_tenant ON tenant_users(tenant_id, user_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_tenant_invitations_token ON tenant_invitations(token, status);
