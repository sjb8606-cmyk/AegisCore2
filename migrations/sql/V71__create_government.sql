-- Idempotency guards to clear any half-applied schema state
DROP TABLE IF EXISTS atip_requests CASCADE;
DROP TABLE IF EXISTS service_requests CASCADE;

CREATE TABLE service_requests (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  request_number  VARCHAR(50) NOT NULL,
  type            VARCHAR(100) NOT NULL,
  subject         VARCHAR(255) NOT NULL,
  status          VARCHAR(20) DEFAULT 'received' CHECK (status IN ('received','in_progress','resolved','closed')),
  encrypted_data  TEXT NOT NULL, -- KMS encrypted citizen PII details
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, request_number)
);

CREATE TABLE atip_requests (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  request_number  VARCHAR(50) NOT NULL,
  subject         VARCHAR(255) NOT NULL,
  regulation      VARCHAR(100),
  due_date        DATE NOT NULL,
  status          VARCHAR(20) DEFAULT 'received' CHECK (status IN ('received','processing','completed','overdue','closed')),
  encrypted_data  TEXT NOT NULL, -- KMS encrypted requester PII details
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, request_number)
);

ALTER TABLE service_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE atip_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_service ON service_requests USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_atip ON atip_requests USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_service_tenant ON service_requests(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_atip_tenant ON atip_requests(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_atip_due ON atip_requests(due_date) WHERE status = 'received';
