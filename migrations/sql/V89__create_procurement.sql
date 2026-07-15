-- Idempotency guards to clear any half-applied schema state
DROP TABLE IF EXISTS purchase_approvals CASCADE;
DROP TABLE IF EXISTS purchase_items CASCADE;
DROP TABLE IF EXISTS purchase_requests CASCADE;

CREATE TABLE purchase_requests (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  request_number     VARCHAR(50) NOT NULL,
  title             VARCHAR(255) NOT NULL,
  description       TEXT,
  status            VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','rejected')),
  requested_by      UUID NOT NULL,
  total_cents       BIGINT DEFAULT 0,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  deleted_at        TIMESTAMP WITH TIME ZONE,
  UNIQUE(tenant_id, request_number)
);

CREATE TABLE purchase_items (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  request_id      UUID NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
  name            VARCHAR(255) NOT NULL,
  quantity        INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents BIGINT NOT NULL CHECK (unit_price_cents >= 0),
  total_cents     BIGINT NOT NULL CHECK (total_cents >= 0)
);

CREATE TABLE purchase_approvals (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  request_id      UUID NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
  approver_id     UUID NOT NULL,
  status          VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reason          TEXT,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  resolved_at     TIMESTAMP WITH TIME ZONE
);

ALTER TABLE purchase_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_pur_requests ON purchase_requests USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_pur_items ON purchase_items USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_pur_approvals ON purchase_approvals USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_pur_requests_tenant ON purchase_requests(tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pur_items_request ON purchase_items(request_id);
CREATE INDEX IF NOT EXISTS idx_pur_approvals_request ON purchase_approvals(request_id);
