CREATE TABLE IF NOT EXISTS products (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL,
  sku          VARCHAR(100) NOT NULL,
  name         VARCHAR(255) NOT NULL,
  description  TEXT,
  price_cents  INTEGER NOT NULL CHECK (price_cents >= 0),
  currency     VARCHAR(3) NOT NULL DEFAULT 'USD',
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, sku)
);

-- V19__create_ecommerce.sql already created "products" (different columns,
-- no sku/currency/active) before this file ever runs. created_at exists on
-- both versions, so this index is safe either way.
CREATE INDEX IF NOT EXISTS idx_products_tenant_created ON products(tenant_id, created_at DESC);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE products FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'products' AND policyname = 'tenant_isolation_products'
  ) THEN
    CREATE POLICY tenant_isolation_products ON products
      USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
  END IF;
END $$;
