CREATE TABLE IF NOT EXISTS engine_hour_usage_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  asset_id UUID NOT NULL,
  reservation_id UUID NOT NULL,
  hours_at_pickup NUMERIC(12,2) NOT NULL CHECK (hours_at_pickup >= 0),
  hours_at_return NUMERIC(12,2),
  included_hours NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (included_hours >= 0),
  overage_rate_per_hour NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (overage_rate_per_hour >= 0),
  maintenance_due_at_hours NUMERIC(12,2) NOT NULL CHECK (maintenance_due_at_hours >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT engine_hours_return_after_pickup
    CHECK (
      hours_at_return IS NULL
      OR hours_at_return >= hours_at_pickup
    ),

  CONSTRAINT engine_hours_reservation_unique
    UNIQUE (tenant_id, reservation_id)
);

ALTER TABLE engine_hour_usage_tracking
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE engine_hour_usage_tracking
  FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_engine_hour_usage_tracking
  ON engine_hour_usage_tracking
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_engine_hours_tenant_asset
  ON engine_hour_usage_tracking (tenant_id, asset_id);

CREATE INDEX IF NOT EXISTS idx_engine_hours_tenant_reservation
  ON engine_hour_usage_tracking (tenant_id, reservation_id);
