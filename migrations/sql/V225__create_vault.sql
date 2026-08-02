-- Secret values are stored via real KMS envelope encryption
-- (@platform/security's encryptField/decryptField) — never plaintext,
-- never a fake base64 "encryption". See apps/example-api/src/routes/vault.ts.
CREATE TABLE vault_secrets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,
  user_id          UUID NOT NULL,
  name             VARCHAR(255) NOT NULL,
  encrypted_value  TEXT NOT NULL,
  created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, name)
);

CREATE INDEX idx_vault_secrets_tenant_user ON vault_secrets(tenant_id, user_id, created_at DESC);

ALTER TABLE vault_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_secrets FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_vault_secrets ON vault_secrets
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
