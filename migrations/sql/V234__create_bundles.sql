CREATE TABLE product_bundles (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  name              VARCHAR(255) NOT NULL,
  product_ids       JSONB NOT NULL DEFAULT '[]',
  bundle_price_cents INTEGER NOT NULL CHECK (bundle_price_cents >= 0),
  active            BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_product_bundles_tenant_created ON product_bundles(tenant_id, created_at DESC);

ALTER TABLE product_bundles ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_bundles FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_product_bundles ON product_bundles
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
