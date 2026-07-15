DROP TABLE IF EXISTS rest_order_items CASCADE;
DROP TABLE IF EXISTS rest_orders CASCADE;
DROP TABLE IF EXISTS rest_menu_items CASCADE;
DROP TABLE IF EXISTS rest_tables CASCADE;

CREATE TABLE rest_tables (
  id             UUID PRIMARY KEY,
  tenant_id      UUID NOT NULL,
  table_number   VARCHAR(50) NOT NULL,
  capacity       INTEGER NOT NULL CHECK (capacity > 0),
  status         VARCHAR(50) NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'occupied', 'reserved')),
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, table_number)
);

CREATE TABLE rest_menu_items (
  id             UUID PRIMARY KEY,
  tenant_id      UUID NOT NULL,
  name           VARCHAR(255) NOT NULL,
  description    TEXT,
  price_cents    BIGINT NOT NULL DEFAULT 0,
  is_available   BOOLEAN DEFAULT true NOT NULL,
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE rest_orders (
  id             UUID PRIMARY KEY,
  tenant_id      UUID NOT NULL,
  table_id       UUID REFERENCES rest_tables(id) ON DELETE SET NULL,
  status         VARCHAR(50) NOT NULL DEFAULT 'placed' CHECK (status IN ('placed', 'preparing', 'ready', 'served', 'paid', 'canceled')),
  total_cents    BIGINT NOT NULL DEFAULT 0,
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE rest_order_items (
  id             UUID PRIMARY KEY,
  tenant_id      UUID NOT NULL,
  order_id       UUID NOT NULL REFERENCES rest_orders(id) ON DELETE CASCADE,
  menu_item_id   UUID NOT NULL REFERENCES rest_menu_items(id) ON DELETE CASCADE,
  quantity       INTEGER NOT NULL CHECK (quantity > 0),
  price_cents    BIGINT NOT NULL,
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE rest_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE rest_menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE rest_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE rest_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_tables ON rest_tables USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_menu ON rest_menu_items USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_orders ON rest_orders USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_order_items ON rest_order_items USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_rest_tables_lookup ON rest_tables(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_rest_orders_status ON rest_orders(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_rest_order_items_lookup ON rest_order_items(order_id);
