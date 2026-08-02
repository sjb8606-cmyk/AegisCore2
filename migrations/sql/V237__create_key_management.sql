-- API keys are stored as salted hashes (scrypt), never plaintext or
-- reversible encoding — same pattern as MFA recovery codes elsewhere in
-- this codebase. The plaintext key is shown to the caller exactly once,
-- at creation time, and never again.
CREATE TABLE api_keys (
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

CREATE INDEX idx_api_keys_tenant_user ON api_keys(tenant_id, user_id, created_at DESC);
CREATE INDEX idx_api_keys_prefix ON api_keys(key_prefix);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_api_keys ON api_keys
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
