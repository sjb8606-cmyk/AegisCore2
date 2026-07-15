CREATE TABLE sandbox_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        UUID NOT NULL REFERENCES sandbox_sessions(id),
  tenant_id         UUID NOT NULL,
  method            VARCHAR(10) NOT NULL,
  path              TEXT NOT NULL,
  request_body      JSONB,
  response_body     JSONB,
  captured_at       TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE sandbox_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE sandbox_requests FORCE ROW LEVEL SECURITY;

CREATE POLICY capture_tenant_isolation ON sandbox_requests
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
