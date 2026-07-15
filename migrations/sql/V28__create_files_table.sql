CREATE TABLE file_records (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    uploaded_by     TEXT NOT NULL,
    name            TEXT NOT NULL,
    s3_key          TEXT NOT NULL,
    size_bytes      BIGINT NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

-- RLS Hardening (V3.6 Doctrine)
ALTER TABLE file_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_records FORCE ROW LEVEL SECURITY;

CREATE POLICY files_tenant_isolation ON file_records 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
