CREATE TABLE volume_load_estimator (
  estimate_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  request_id UUID NOT NULL,
  photos JSONB NOT NULL DEFAULT '[]'::jsonb,
  estimated_cubic_yards NUMERIC(12, 3) NOT NULL
    CHECK (estimated_cubic_yards >= 0),
  final_cubic_yards NUMERIC(12, 3)
    CHECK (
      final_cubic_yards IS NULL OR
      final_cubic_yards >= 0
    ),
  price_variance NUMERIC(12, 3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_volume_load_estimator_tenant_request
  ON volume_load_estimator (
    tenant_id,
    request_id
  );

CREATE INDEX idx_volume_load_estimator_tenant
  ON volume_load_estimator (tenant_id);

ALTER TABLE volume_load_estimator
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE volume_load_estimator
  FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_volume_load_estimator
  ON volume_load_estimator
  USING (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  )
  WITH CHECK (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  );
