CREATE TABLE vehicle_impound_lien_tracking (
  impound_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  vehicle_vin TEXT NOT NULL,
  license_plate TEXT,
  impound_date TIMESTAMPTZ NOT NULL,
  reason TEXT NOT NULL
    CHECK (
      reason IN (
        'abandoned',
        'accident',
        'police_hold',
        'non_payment'
      )
    ),
  lien_filed_date TIMESTAMPTZ,
  release_eligible_date TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'held'
    CHECK (
      status IN (
        'held',
        'released',
        'auctioned'
      )
    ),
  released_to TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_vehicle_impound_tenant_vin
  ON vehicle_impound_lien_tracking (
    tenant_id,
    vehicle_vin
  );

CREATE INDEX idx_vehicle_impound_tenant_status
  ON vehicle_impound_lien_tracking (
    tenant_id,
    status
  );

ALTER TABLE vehicle_impound_lien_tracking
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE vehicle_impound_lien_tracking
  FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_vehicle_impound_lien_tracking
  ON vehicle_impound_lien_tracking
  USING (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  )
  WITH CHECK (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  );
