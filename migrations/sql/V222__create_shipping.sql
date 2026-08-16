CREATE TABLE IF NOT EXISTS shipments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,
  order_id         UUID NOT NULL,
  carrier          VARCHAR(100) NOT NULL,
  tracking_number  VARCHAR(255) NOT NULL,
  status           VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'shipped', 'in_transit', 'delivered', 'cancelled')),
  shipped_at       TIMESTAMP WITH TIME ZONE,
  delivered_at     TIMESTAMP WITH TIME ZONE,
  created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- V69__create_logistics.sql already created "shipments" (a real-world
-- carrier tracking table, no order_id column) before this file ever runs.
-- Guard the order_id index the same way V218 guarded assignee_id.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'shipments' AND column_name = 'order_id'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_shipments_tenant_order ON shipments(tenant_id, order_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_shipments_tenant_created ON shipments(tenant_id, created_at DESC);

ALTER TABLE shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipments FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'shipments' AND policyname = 'tenant_isolation_shipments'
  ) THEN
    CREATE POLICY tenant_isolation_shipments ON shipments
      USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
  END IF;
END $$;
