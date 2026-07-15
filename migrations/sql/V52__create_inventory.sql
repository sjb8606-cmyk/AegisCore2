CREATE TABLE IF NOT EXISTS inventory_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  name              VARCHAR(255) NOT NULL,
  sku               VARCHAR(100) NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ,
  UNIQUE(tenant_id, sku)
);

CREATE TABLE IF NOT EXISTS stock_levels (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  item_id           UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  location_id       UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  quantity          INTEGER NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, item_id, location_id)
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  item_id           UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  location_id       UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  type              VARCHAR(30) NOT NULL CHECK (type IN ('receive', 'ship', 'adjust', 'transfer', 'return', 'write_off')),
  quantity          INTEGER NOT NULL,
  before_qty        INTEGER NOT NULL,
  after_qty         INTEGER NOT NULL,
  performed_by      UUID NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security Activation
ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items FORCE ROW LEVEL SECURITY;

ALTER TABLE stock_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_levels FORCE ROW LEVEL SECURITY;

ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements FORCE ROW LEVEL SECURITY;

-- Dynamic Tenant Isolation Policies
CREATE POLICY tenant_isolation_items ON inventory_items 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_levels ON stock_levels 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_movements ON stock_movements 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Core Query Optimization Indices
CREATE INDEX IF NOT EXISTS idx_items_tenant ON inventory_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_levels_lookup ON stock_levels(tenant_id, item_id, location_id);
CREATE INDEX IF NOT EXISTS idx_movements_lookup ON stock_movements(tenant_id, item_id);
