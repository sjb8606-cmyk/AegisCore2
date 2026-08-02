CREATE TABLE dropship_orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  order_id        UUID NOT NULL,
  supplier_name   VARCHAR(255) NOT NULL,
  supplier_order_ref VARCHAR(255),
  status          VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent_to_supplier', 'fulfilled', 'cancelled')),
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_dropship_orders_tenant_order ON dropship_orders(tenant_id, order_id);

ALTER TABLE dropship_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE dropship_orders FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_dropship_orders ON dropship_orders
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
