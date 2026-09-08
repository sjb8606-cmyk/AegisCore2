CREATE TABLE IF NOT EXISTS engine_hour_usage (
  usage_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  asset_id UUID NOT NULL,
  reservation_id UUID NOT NULL,
  hours_at_pickup NUMERIC(12,2) NOT NULL CHECK (hours_at_pickup >= 0),
  hours_at_return NUMERIC(12,2) NOT NULL CHECK (hours_at_return >= hours_at_pickup),
  included_hours NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (included_hours >= 0),
  overage_rate_per_hour NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (overage_rate_per_hour >= 0),
  maintenance_due_at_hours NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (maintenance_due_at_hours >= 0),
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE engine_hour_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE engine_hour_usage FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_engine_hour_usage
  ON engine_hour_usage
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_engine_hour_usage_tenant_asset
  ON engine_hour_usage (tenant_id, asset_id);

CREATE INDEX IF NOT EXISTS idx_engine_hour_usage_tenant_reservation
  ON engine_hour_usage (tenant_id, reservation_id);
