CREATE TABLE IF NOT EXISTS employees (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  first_name        VARCHAR(255) NOT NULL,
  last_name         VARCHAR(255) NOT NULL,
  email             VARCHAR(255) NOT NULL,
  phone             VARCHAR(50),
  job_title         VARCHAR(100),
  department        VARCHAR(100),
  manager_id        UUID,
  employment_type   VARCHAR(50),
  start_date        DATE,
  encrypted_data    TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ,
  UNIQUE(tenant_id, email)
);

CREATE TABLE IF NOT EXISTS time_entries (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  employee_id       UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  clock_in          TIMESTAMPTZ NOT NULL,
  clock_out         TIMESTAMPTZ,
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security Activation
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees FORCE ROW LEVEL SECURITY;

ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_entries FORCE ROW LEVEL SECURITY;

-- Dynamic Tenant Isolation Policies
CREATE POLICY tenant_isolation_employees ON employees 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_time_entries ON time_entries 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Core Query Optimization Indices
CREATE INDEX IF NOT EXISTS idx_employees_tenant ON employees(tenant_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_employees_lookup ON employees(tenant_id, email);
CREATE INDEX IF NOT EXISTS idx_time_entries_employee ON time_entries(employee_id, clock_out);
