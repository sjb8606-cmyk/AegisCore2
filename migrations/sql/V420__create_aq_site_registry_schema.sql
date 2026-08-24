CREATE TABLE IF NOT EXISTS aq_site (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  site_name TEXT NOT NULL,
  lease_number TEXT,
  licence_number TEXT,
  boundary_geojson JSONB NOT NULL,
  area_hectares NUMERIC NOT NULL,
  species_authorized JSONB NOT NULL,
  culture_method TEXT NOT NULL,
  tenure_type TEXT NOT NULL,
  expiry_date TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_aq_site_tenant ON aq_site(tenant_id);
CREATE INDEX IF NOT EXISTS idx_aq_site_expiry ON aq_site(tenant_id, expiry_date);
