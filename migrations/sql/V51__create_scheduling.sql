CREATE TABLE IF NOT EXISTS scheduling_services (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  name              VARCHAR(255) NOT NULL,
  duration_minutes  INTEGER NOT NULL DEFAULT 30,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS appointments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  service_id        UUID NOT NULL REFERENCES scheduling_services(id) ON DELETE CASCADE,
  staff_id          UUID,
  client_name       VARCHAR(255) NOT NULL,
  client_email      VARCHAR(255) NOT NULL,
  client_phone      VARCHAR(50),
  start_at          TIMESTAMPTZ NOT NULL,
  status            VARCHAR(30) DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'canceled')),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security Activation
ALTER TABLE scheduling_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduling_services FORCE ROW LEVEL SECURITY;

ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments FORCE ROW LEVEL SECURITY;

-- Dynamic Tenant Isolation Policies
CREATE POLICY tenant_isolation_services ON scheduling_services 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_appointments ON appointments 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Core Query Optimization Indices
CREATE INDEX IF NOT EXISTS idx_services_tenant ON scheduling_services(tenant_id);
CREATE INDEX IF NOT EXISTS idx_appointments_lookup ON appointments(tenant_id, start_at);
CREATE INDEX IF NOT EXISTS idx_appointments_service ON appointments(service_id);
