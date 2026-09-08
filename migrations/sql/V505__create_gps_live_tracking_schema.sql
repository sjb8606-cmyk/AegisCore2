CREATE TABLE gps_live_tracking (
  tracking_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  job_id UUID NOT NULL,
  driver_id UUID NOT NULL,
  current_lat NUMERIC(10, 7) NOT NULL,
  current_lng NUMERIC(10, 7) NOT NULL,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  eta_minutes_remaining INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT gps_live_tracking_lat_check
    CHECK (current_lat >= -90 AND current_lat <= 90),

  CONSTRAINT gps_live_tracking_lng_check
    CHECK (current_lng >= -180 AND current_lng <= 180),

  CONSTRAINT gps_live_tracking_eta_check
    CHECK (eta_minutes_remaining >= 0)
);

CREATE UNIQUE INDEX idx_gps_live_tracking_tenant_job
  ON gps_live_tracking (tenant_id, job_id);

CREATE INDEX idx_gps_live_tracking_tenant_driver
  ON gps_live_tracking (tenant_id, driver_id);

ALTER TABLE gps_live_tracking
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE gps_live_tracking
  FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_gps_live_tracking
  ON gps_live_tracking
  USING (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  )
  WITH CHECK (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  );
