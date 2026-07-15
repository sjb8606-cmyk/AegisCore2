-- Idempotency guards to clear any half-applied schema state
DROP TABLE IF EXISTS document_analyses CASCADE;

CREATE TABLE document_analyses (
  id             UUID PRIMARY KEY,
  tenant_id      UUID NOT NULL,
  file_id        UUID NOT NULL,
  status         VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
  operation      VARCHAR(20) NOT NULL CHECK (operation IN ('extract','summarize','classify','qa','compare','translate')),
  result         JSONB DEFAULT '{}',
  duration_ms    INTEGER,
  created_by     UUID NOT NULL,
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE document_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_analyses ON document_analyses USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_analyses_tenant ON document_analyses(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_analyses_file ON document_analyses(file_id);
