CREATE TABLE scenario_results (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  scenario_name   VARCHAR(100) NOT NULL,
  status          VARCHAR(20) NOT NULL, -- 'passed' or 'failed'
  steps_executed  INTEGER NOT NULL,
  error_log       TEXT,
  executed_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Harden with RLS
ALTER TABLE scenario_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE scenario_results FORCE ROW LEVEL SECURITY;

CREATE POLICY scenario_tenant_isolation ON scenario_results
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
