CREATE TABLE consent_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  user_id TEXT NOT NULL,
  consent_type VARCHAR(100) NOT NULL,
  granted BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE data_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  user_id TEXT NOT NULL,
  request_type VARCHAR(50) NOT NULL CHECK (request_type IN ('access', 'deletion', 'portability')),
  status VARCHAR(20) DEFAULT 'pending',
  due_date TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Security Hardening
ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY consent_tenant_isolation ON consent_records 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY dreq_tenant_isolation ON data_requests 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
