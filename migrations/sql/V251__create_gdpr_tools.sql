CREATE TABLE gdpr_subject_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  user_id       UUID NOT NULL,
  request_type  VARCHAR(20) NOT NULL CHECK (request_type IN ('access', 'deletion', 'portability', 'rectification')),
  status        VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'rejected')),
  notes         TEXT,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  completed_at  TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_gdpr_subject_requests_tenant_user ON gdpr_subject_requests(tenant_id, user_id, created_at DESC);

ALTER TABLE gdpr_subject_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE gdpr_subject_requests FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_gdpr_subject_requests ON gdpr_subject_requests
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
