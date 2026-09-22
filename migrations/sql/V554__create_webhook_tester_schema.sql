-- @platform/webhook-tester — outbound webhook test runs + history

CREATE TABLE IF NOT EXISTS webhook_test_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  target_url      TEXT NOT NULL,
  method          VARCHAR(10) NOT NULL DEFAULT 'POST',
  request_headers JSONB NOT NULL DEFAULT '{}',
  request_body    JSONB,
  status_code     INTEGER,
  response_headers JSONB,
  response_body   TEXT,
  duration_ms     INTEGER,
  success         BOOLEAN NOT NULL DEFAULT false,
  error_message   TEXT,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_test_runs_tenant
  ON webhook_test_runs (tenant_id, created_at DESC);

ALTER TABLE webhook_test_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_webhook_tests ON webhook_test_runs;
CREATE POLICY tenant_isolation_webhook_tests ON webhook_test_runs
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
