CREATE TABLE IF NOT EXISTS tenants (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 VARCHAR(255) NOT NULL,
  preferred_language   VARCHAR(5) NOT NULL DEFAULT 'en' CHECK (preferred_language IN ('en', 'fr')),
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  deleted_at           TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS tenant_members (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  oidc_sub     VARCHAR(255) NOT NULL,
  role         VARCHAR(50) NOT NULL DEFAULT 'tenant_admin',
  joined_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(oidc_sub)
);

CREATE INDEX IF NOT EXISTS idx_tenant_members_sub ON tenant_members(oidc_sub);
