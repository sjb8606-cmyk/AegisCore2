CREATE TABLE collab_documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  user_id       UUID NOT NULL,
  title         VARCHAR(255) NOT NULL,
  content       TEXT NOT NULL DEFAULT '',
  version       INTEGER NOT NULL DEFAULT 1,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_collab_documents_tenant_user ON collab_documents(tenant_id, user_id, created_at DESC);

ALTER TABLE collab_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE collab_documents FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_collab_documents ON collab_documents
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
