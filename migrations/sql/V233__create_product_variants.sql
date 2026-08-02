CREATE TABLE product_variants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  product_id    UUID NOT NULL,
  sku_suffix    VARCHAR(50) NOT NULL,
  attributes    JSONB NOT NULL DEFAULT '{}',
  price_cents   INTEGER NOT NULL CHECK (price_cents >= 0),
  stock_count   INTEGER NOT NULL DEFAULT 0 CHECK (stock_count >= 0),
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, product_id, sku_suffix)
);

CREATE INDEX idx_product_variants_tenant_product ON product_variants(tenant_id, product_id);

ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_variants FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_product_variants ON product_variants
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
