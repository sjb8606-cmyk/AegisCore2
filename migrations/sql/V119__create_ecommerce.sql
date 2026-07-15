DROP TABLE IF EXISTS ec_order_items CASCADE;
DROP TABLE IF EXISTS ec_orders CASCADE;
DROP TABLE IF EXISTS ec_cart_items CASCADE;
DROP TABLE IF EXISTS ec_carts CASCADE;
DROP TABLE IF EXISTS ec_products CASCADE;
DROP TABLE IF EXISTS ec_storefronts CASCADE;

CREATE TABLE ec_storefronts (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  name            VARCHAR(255) NOT NULL,
  slug            VARCHAR(255) NOT NULL,
  currency        VARCHAR(10) NOT NULL DEFAULT 'USD',
  locale          VARCHAR(20) NOT NULL DEFAULT 'en',
  active          BOOLEAN DEFAULT true NOT NULL,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, slug)
);

CREATE TABLE ec_products (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  storefront_id   UUID NOT NULL REFERENCES ec_storefronts(id) ON DELETE CASCADE,
  name            VARCHAR(255) NOT NULL,
  slug            VARCHAR(255) NOT NULL,
  description     TEXT,
  status          VARCHAR(30) CHECK (status IN ('draft','active','archived')),
  price           NUMERIC(14,4) NOT NULL DEFAULT 0,
  compare_price   NUMERIC(14,4),
  sku             VARCHAR(100),
  inventory_ref   UUID,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, storefront_id, slug)
);

CREATE TABLE ec_carts (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  storefront_id   UUID NOT NULL REFERENCES ec_storefronts(id) ON DELETE CASCADE,
  customer_ref    UUID,
  status          VARCHAR(30) CHECK (status IN ('open','checkout','converted','abandoned','expired')),
  currency        VARCHAR(10) NOT NULL DEFAULT 'USD',
  expires_at      TIMESTAMP WITH TIME ZONE,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ec_cart_items (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  cart_id         UUID NOT NULL REFERENCES ec_carts(id) ON DELETE CASCADE,
  product_id      UUID NOT NULL REFERENCES ec_products(id) ON DELETE CASCADE,
  quantity        INTEGER NOT NULL CHECK (quantity > 0),
  unit_price      NUMERIC(14,4) NOT NULL,
  discount_amount NUMERIC(14,4) DEFAULT 0 NOT NULL,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ec_orders (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  storefront_id   UUID NOT NULL REFERENCES ec_storefronts(id) ON DELETE CASCADE,
  cart_id         UUID REFERENCES ec_carts(id) ON DELETE SET NULL,
  customer_ref    UUID,
  status          VARCHAR(30) CHECK (status IN ('pending','confirmed','processing','fulfilled','shipped','delivered','canceled','refunded')),
  subtotal        NUMERIC(14,4) NOT NULL DEFAULT 0,
  discount_total  NUMERIC(14,4) DEFAULT 0 NOT NULL,
  tax_total       NUMERIC(14,4) DEFAULT 0 NOT NULL,
  shipping_total  NUMERIC(14,4) DEFAULT 0 NOT NULL,
  total           NUMERIC(14,4) NOT NULL DEFAULT 0,
  currency        VARCHAR(10) NOT NULL DEFAULT 'USD',
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ec_order_items (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  order_id        UUID NOT NULL REFERENCES ec_orders(id) ON DELETE CASCADE,
  product_id      UUID NOT NULL REFERENCES ec_products(id) ON DELETE CASCADE,
  quantity        INTEGER NOT NULL CHECK (quantity > 0),
  unit_price      NUMERIC(14,4) NOT NULL,
  discount_amount NUMERIC(14,4) DEFAULT 0 NOT NULL,
  tax_amount      NUMERIC(14,4) DEFAULT 0 NOT NULL,
  total           NUMERIC(14,4) NOT NULL,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE ec_storefronts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ec_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE ec_carts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ec_cart_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE ec_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE ec_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_storefronts ON ec_storefronts USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_products ON ec_products USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_carts ON ec_carts USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_cart_items ON ec_cart_items USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_orders ON ec_orders USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_order_items ON ec_order_items USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX idx_ec_carts_expires ON ec_carts(expires_at) WHERE status = 'open';
CREATE INDEX idx_ec_orders_tenant_status ON ec_orders(tenant_id, status);
