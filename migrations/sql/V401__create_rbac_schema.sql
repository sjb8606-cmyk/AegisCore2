CREATE TABLE IF NOT EXISTS rbac_role (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  permissions JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, name)
);
CREATE TABLE IF NOT EXISTS rbac_user_role (
  tenant_id UUID NOT NULL,
  user_id TEXT NOT NULL,
  role_id UUID NOT NULL,
  PRIMARY KEY (tenant_id, user_id)
);
