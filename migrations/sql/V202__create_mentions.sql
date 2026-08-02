CREATE TABLE mentions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL,
  mentioned_user_id     UUID NOT NULL,
  mentioned_by_user_id  UUID NOT NULL,
  resource_type         VARCHAR(100) NOT NULL,
  resource_id           UUID NOT NULL,
  context_snippet       TEXT,
  created_at            TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_mentions_tenant_mentioned_user ON mentions(tenant_id, mentioned_user_id, created_at DESC);

ALTER TABLE mentions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mentions FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_mentions ON mentions
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
