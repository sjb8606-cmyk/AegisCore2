CREATE TABLE form_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    form_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS Enforcement
ALTER TABLE form_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY form_tenant_isolation ON form_submissions
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
