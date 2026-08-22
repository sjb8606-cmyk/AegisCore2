CREATE TABLE IF NOT EXISTS location_point (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lon DOUBLE PRECISION NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (tenant_id, entity_type, entity_id)
);
-- Production: add PostGIS geography column + GIST index
-- CREATE INDEX idx_location_geo ON location_point USING GIST (ll_to_earth(lat, lon));
CREATE INDEX IF NOT EXISTS idx_location_tenant_type
  ON location_point(tenant_id, entity_type);
