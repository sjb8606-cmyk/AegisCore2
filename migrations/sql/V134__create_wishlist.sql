DROP TABLE IF EXISTS wishlist_items CASCADE;

CREATE TABLE wishlist_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    user_id UUID NOT NULL,
    item_ref VARCHAR(255) NOT NULL,
    item_name VARCHAR(255) NOT NULL,
    notes TEXT,
    priority VARCHAR(10) DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, user_id, item_ref)
);

CREATE INDEX idx_wishlist_items_user ON wishlist_items(tenant_id, user_id);

ALTER TABLE wishlist_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_wishlist_items ON wishlist_items USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
