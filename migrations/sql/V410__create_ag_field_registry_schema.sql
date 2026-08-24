CREATE TABLE IF NOT EXISTS ag_field (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  pid_number TEXT,
  arms_id TEXT,
  boundary_geojson JSONB NOT NULL,
  acres NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS ag_restricted_zone (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  field_id UUID NOT NULL,
  zone_type TEXT NOT NULL,
  geometry JSONB NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ag_field_tenant ON ag_field(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ag_zone_field ON ag_restricted_zone(tenant_id, field_id);
-- Production: PostGIS geometry column + GIST index for boundary
