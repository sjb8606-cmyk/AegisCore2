-- @platform/api-docs — endpoint registry + OpenAPI snapshots

CREATE TABLE IF NOT EXISTS api_endpoints (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  method          VARCHAR(10) NOT NULL
                    CHECK (method IN ('GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS')),
  path            VARCHAR(500) NOT NULL,
  summary         VARCHAR(255),
  description     TEXT,
  tags            JSONB NOT NULL DEFAULT '[]',
  request_schema  JSONB,
  response_schema JSONB,
  auth_required   BOOLEAN NOT NULL DEFAULT true,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, method, path)
);

CREATE TABLE IF NOT EXISTS api_doc_versions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  version         VARCHAR(40) NOT NULL,
  title           VARCHAR(255) NOT NULL,
  openapi_doc     JSONB NOT NULL,
  published       BOOLEAN NOT NULL DEFAULT false,
  published_by    UUID,
  published_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, version)
);

CREATE INDEX IF NOT EXISTS idx_api_endpoints_tenant ON api_endpoints (tenant_id, active);
CREATE INDEX IF NOT EXISTS idx_api_doc_versions_tenant ON api_doc_versions (tenant_id, created_at DESC);

ALTER TABLE api_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_doc_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_api_endpoints ON api_endpoints;
CREATE POLICY tenant_isolation_api_endpoints ON api_endpoints
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

DROP POLICY IF EXISTS tenant_isolation_api_doc_versions ON api_doc_versions;
CREATE POLICY tenant_isolation_api_doc_versions ON api_doc_versions
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
