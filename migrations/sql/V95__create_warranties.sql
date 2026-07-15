DROP TABLE IF EXISTS saas_service_tickets CASCADE;
DROP TABLE IF EXISTS saas_claims CASCADE;
DROP TABLE IF EXISTS saas_warranties CASCADE;

CREATE TABLE saas_warranties (
  id             UUID PRIMARY KEY,
  tenant_id      UUID NOT NULL,
  product_id     UUID NOT NULL,
  customer_id    UUID NOT NULL,
  serial_number  VARCHAR(100),
  purchase_id    UUID,
  status         VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'void')),
  start_date     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  end_date       TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE saas_claims (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  warranty_id       UUID NOT NULL REFERENCES saas_warranties(id) ON DELETE CASCADE,
  issue_description TEXT NOT NULL,
  severity          INTEGER NOT NULL DEFAULT 1 CHECK (severity BETWEEN 1 AND 5),
  claim_score       NUMERIC(3,2) NOT NULL,
  status            VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'under_review', 'approved', 'rejected', 'completed')),
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE saas_service_tickets (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  claim_id        UUID NOT NULL REFERENCES saas_claims(id) ON DELETE CASCADE,
  technician_name VARCHAR(255) NOT NULL,
  dispatch_status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (dispatch_status IN ('pending', 'dispatched', 'completed')),
  scheduled_at    TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE saas_warranties ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_service_tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_warranties ON saas_warranties USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_claims ON saas_claims USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_tickets ON saas_service_tickets USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_warranties_customer ON saas_warranties(tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_claims_warranty ON saas_claims(warranty_id);
CREATE INDEX IF NOT EXISTS idx_tickets_claim ON saas_service_tickets(claim_id);
