-- Idempotency guards to clear any half-applied schema state
DROP TABLE IF EXISTS clock_events CASCADE;

CREATE TABLE clock_events (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  employee_id       UUID NOT NULL,
  status            VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','completed')),
  clock_in_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  clock_out_at      TIMESTAMP WITH TIME ZONE,
  project_id        UUID,
  location_data     JSONB DEFAULT '{}',
  duration_minutes  INTEGER,
  overtime_minutes  INTEGER,
  notes             TEXT
);

ALTER TABLE clock_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_clock_events ON clock_events USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Database-enforced duplicate clock-in prevention safeguard (Partial Unique Index)
CREATE UNIQUE INDEX idx_active_clock_in ON clock_events(tenant_id, employee_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_clock_events_tenant ON clock_events(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_clock_events_employee ON clock_events(tenant_id, employee_id);
