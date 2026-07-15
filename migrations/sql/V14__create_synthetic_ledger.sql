CREATE TABLE synthetic_data_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  sandbox_id      UUID,
  data_type       VARCHAR(50) NOT NULL,
  record_count    INTEGER NOT NULL,
  actor_id        TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Harden with RLS
ALTER TABLE synthetic_data_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE synthetic_data_logs FORCE ROW LEVEL SECURITY;

CREATE POLICY synthetic_tenant_isolation ON synthetic_data_logs
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
