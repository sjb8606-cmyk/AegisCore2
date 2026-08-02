CREATE TABLE blockchain_verifications (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  user_id        UUID NOT NULL,
  resource_ref   VARCHAR(255) NOT NULL,
  content_hash   VARCHAR(128) NOT NULL,
  chain          VARCHAR(50) NOT NULL DEFAULT 'internal',
  tx_ref         VARCHAR(255),
  verified_at    TIMESTAMP WITH TIME ZONE,
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_blockchain_verifications_tenant_resource ON blockchain_verifications(tenant_id, resource_ref);

ALTER TABLE blockchain_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE blockchain_verifications FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_blockchain_verifications ON blockchain_verifications
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
