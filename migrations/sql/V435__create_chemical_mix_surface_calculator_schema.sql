CREATE TABLE chemical_mix_surface_calculator (
  calculation_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  property_id UUID NOT NULL,
  surface_type TEXT NOT NULL
    CHECK (
      surface_type IN (
        'concrete',
        'vinyl_siding',
        'wood_deck',
        'roof',
        'brick'
      )
    ),
  chemical_type TEXT NOT NULL,
  dilution_ratio TEXT NOT NULL,
  area_sqft NUMERIC(14, 2) NOT NULL
    CHECK (area_sqft > 0),
  estimated_chemical_needed_gallons NUMERIC(14, 3) NOT NULL
    CHECK (
      estimated_chemical_needed_gallons > 0
    ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chemical_mix_surface_calculator_tenant_property
  ON chemical_mix_surface_calculator (
    tenant_id,
    property_id
  );

ALTER TABLE chemical_mix_surface_calculator
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE chemical_mix_surface_calculator
  FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_chemical_mix_surface_calculator
  ON chemical_mix_surface_calculator
  USING (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  )
  WITH CHECK (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  );
