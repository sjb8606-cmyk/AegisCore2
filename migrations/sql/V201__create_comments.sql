CREATE TABLE comments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  user_id        UUID NOT NULL,
  resource_type  VARCHAR(100) NOT NULL,
  resource_id    UUID NOT NULL,
  body           TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 10000),
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  deleted_at     TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_comments_tenant_resource ON comments(tenant_id, resource_type, resource_id, created_at DESC);
CREATE INDEX idx_comments_tenant_user ON comments(tenant_id, user_id);

ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_comments ON comments
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
