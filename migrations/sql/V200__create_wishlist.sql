CREATE TABLE wishlist_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  user_id       UUID NOT NULL,
  product_id    UUID NOT NULL,
  product_name  VARCHAR(255) NOT NULL,
  note          TEXT,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, user_id, product_id)
);

CREATE INDEX idx_wishlist_items_tenant_user ON wishlist_items(tenant_id, user_id, created_at DESC);

ALTER TABLE wishlist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE wishlist_items FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_wishlist_items ON wishlist_items
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
