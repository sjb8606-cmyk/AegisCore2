-- API keys are stored as salted hashes (scrypt), never plaintext or
-- reversible encoding — same pattern as MFA recovery codes elsewhere in
-- this codebase. The plaintext key is shown to the caller exactly once,
-- at creation time, and never again.
CREATE TABLE IF NOT EXISTS api_keys (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL,
  user_id      UUID NOT NULL,
  name         VARCHAR(255) NOT NULL,
  key_prefix   VARCHAR(12) NOT NULL,
  key_hash     TEXT NOT NULL,
  last_used_at TIMESTAMP WITH TIME ZONE,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  revoked_at   TIMESTAMP WITH TIME ZONE
);

-- V76__create_api_gateway.sql already created "api_keys" (rate limits,
-- IP whitelist, scopes — no user_id column) before this file ever runs.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'api_keys' AND column_name = 'user_id'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_api_keys_tenant_user ON api_keys(tenant_id, user_id, created_at DESC);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'api_keys' AND policyname = 'tenant_isolation_api_keys'
  ) THEN
    CREATE POLICY tenant_isolation_api_keys ON api_keys
      USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
  END IF;
END $$;
