CREATE TABLE IF NOT EXISTS fisheries_species (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   UUID NOT NULL,
  common_name                 VARCHAR(255) NOT NULL,
  scientific_name             VARCHAR(255) NOT NULL,
  species_code                VARCHAR(50) NOT NULL,
  category                    VARCHAR(20) NOT NULL CHECK (category IN ('finfish', 'shellfish', 'crustacean', 'other')),
  default_yield_rate_percent  NUMERIC(5,2),
  min_legal_size_cm           NUMERIC(6,2),
  is_active                   BOOLEAN NOT NULL DEFAULT true,
  created_at                  TIMESTAMPTZ DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ DEFAULT NOW(),
  deleted_at                  TIMESTAMPTZ,
  UNIQUE(tenant_id, species_code)
);

ALTER TABLE fisheries_species ENABLE ROW LEVEL SECURITY;
ALTER TABLE fisheries_species FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_species ON fisheries_species
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_fisheries_species_tenant ON fisheries_species(tenant_id);
CREATE INDEX IF NOT EXISTS idx_fisheries_species_active ON fisheries_species(tenant_id, is_active) WHERE deleted_at IS NULL;
