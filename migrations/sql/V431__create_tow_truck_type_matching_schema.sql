CREATE TABLE tow_truck_type_matching (
  match_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  vehicle_type TEXT NOT NULL
    CHECK (
      vehicle_type IN (
        'sedan',
        'suv',
        'motorcycle',
        'heavy_truck',
        'exotic'
      )
    ),
  situation TEXT NOT NULL
    CHECK (
      situation IN (
        'flat_tire',
        'accident',
        'off_road_recovery',
        'standard_tow'
      )
    ),
  required_truck_type TEXT NOT NULL
    CHECK (
      required_truck_type IN (
        'flatbed',
        'wheel_lift',
        'heavy_duty',
        'motorcycle_trailer'
      )
    ),
  location TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tow_truck_type_matching_tenant
  ON tow_truck_type_matching (tenant_id);

CREATE INDEX idx_tow_truck_type_matching_required_type
  ON tow_truck_type_matching (
    tenant_id,
    required_truck_type
  );

ALTER TABLE tow_truck_type_matching
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE tow_truck_type_matching
  FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_tow_truck_type_matching
  ON tow_truck_type_matching
  USING (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  )
  WITH CHECK (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  );
