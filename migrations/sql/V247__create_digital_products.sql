CREATE TABLE digital_products (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  user_id       UUID NOT NULL,
  name          VARCHAR(255) NOT NULL,
  file_url      TEXT NOT NULL,
  price_cents   INTEGER NOT NULL CHECK (price_cents >= 0),
  download_limit INTEGER,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_digital_products_tenant_created ON digital_products(tenant_id, created_at DESC);

ALTER TABLE digital_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE digital_products FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_digital_products ON digital_products
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
