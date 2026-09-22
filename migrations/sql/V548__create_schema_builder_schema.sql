-- @platform/schema-builder — dynamic form/schema definitions

CREATE TABLE IF NOT EXISTS dynamic_schemas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key             VARCHAR(100) NOT NULL,
  name            VARCHAR(255) NOT NULL,
  description     TEXT,
  status          VARCHAR(20) NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','published','archived')),
  version         INTEGER NOT NULL DEFAULT 1,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, key)
);

CREATE TABLE IF NOT EXISTS dynamic_schema_fields (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  schema_id       UUID NOT NULL REFERENCES dynamic_schemas(id) ON DELETE CASCADE,
  field_key       VARCHAR(100) NOT NULL,
  label           VARCHAR(255) NOT NULL,
  field_type      VARCHAR(40) NOT NULL
                    CHECK (field_type IN (
                      'string','number','boolean','date','datetime',
                      'email','url','select','multiselect','textarea','file'
                    )),
  required        BOOLEAN NOT NULL DEFAULT false,
  options         JSONB,
  validation      JSONB,
  section         VARCHAR(100),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (schema_id, field_key)
);

CREATE TABLE IF NOT EXISTS dynamic_schema_versions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  schema_id       UUID NOT NULL REFERENCES dynamic_schemas(id) ON DELETE CASCADE,
  version         INTEGER NOT NULL,
  snapshot        JSONB NOT NULL,
  published_by    UUID,
  published_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (schema_id, version)
);

CREATE INDEX IF NOT EXISTS idx_dynamic_schemas_tenant ON dynamic_schemas (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_dynamic_fields_schema ON dynamic_schema_fields (schema_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_dynamic_versions_schema ON dynamic_schema_versions (schema_id, version DESC);

ALTER TABLE dynamic_schemas ENABLE ROW LEVEL SECURITY;
ALTER TABLE dynamic_schema_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE dynamic_schema_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_dyn_schemas ON dynamic_schemas;
CREATE POLICY tenant_isolation_dyn_schemas ON dynamic_schemas
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

DROP POLICY IF EXISTS tenant_isolation_dyn_fields ON dynamic_schema_fields;
CREATE POLICY tenant_isolation_dyn_fields ON dynamic_schema_fields
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

DROP POLICY IF EXISTS tenant_isolation_dyn_versions ON dynamic_schema_versions;
CREATE POLICY tenant_isolation_dyn_versions ON dynamic_schema_versions
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
