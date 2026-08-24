CREATE TABLE IF NOT EXISTS rest_item_allergens (
  tenant_id UUID NOT NULL,
  menu_item_id UUID NOT NULL,
  allergens JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, menu_item_id)
);
CREATE TABLE IF NOT EXISTS rest_guest_allergies (
  tenant_id UUID NOT NULL,
  guest_key TEXT NOT NULL,
  allergies JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, guest_key)
);
