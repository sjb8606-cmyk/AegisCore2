DROP TABLE IF EXISTS refund_transactions CASCADE;
DROP TABLE IF EXISTS return_items CASCADE;
DROP TABLE IF EXISTS return_requests CASCADE;

CREATE TABLE return_requests (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  order_id          UUID NOT NULL,
  customer_id       UUID NOT NULL,
  rma_number        VARCHAR(100) NOT NULL UNIQUE,
  reason            VARCHAR(255) NOT NULL,
  description       TEXT,
  status            VARCHAR(50) NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'approved', 'received', 'rejected', 'refunded', 'completed')),
  total_refund_cents BIGINT NOT NULL DEFAULT 0,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE return_items (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  return_request_id UUID NOT NULL REFERENCES return_requests(id) ON DELETE CASCADE,
  item_id           VARCHAR(255) NOT NULL,
  quantity          INTEGER NOT NULL CHECK (quantity > 0),
  refund_cents      BIGINT NOT NULL DEFAULT 0,
  restocking_status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (restocking_status IN ('pending', 'restocked', 'damaged'))
);

CREATE TABLE refund_transactions (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  return_request_id UUID NOT NULL REFERENCES return_requests(id) ON DELETE CASCADE,
  amount_cents      BIGINT NOT NULL,
  status            VARCHAR(50) NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed')),
  reference_id      VARCHAR(255),
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE return_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE return_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE refund_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_rr ON return_requests USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_ri ON return_items USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_rt ON refund_transactions USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_returns_tenant_status ON return_requests(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_returns_rma ON return_requests(rma_number);
CREATE INDEX IF NOT EXISTS idx_refund_request ON refund_transactions(return_request_id);
