CREATE TABLE weather_triggered_dispatch (
  trigger_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  property_id UUID NOT NULL,
  accumulation_threshold_inches NUMERIC(8,2) NOT NULL
    CHECK (accumulation_threshold_inches >= 0),
  current_accumulation NUMERIC(8,2) NOT NULL DEFAULT 0
    CHECK (current_accumulation >= 0),
  weather_source TEXT NOT NULL,
  triggered BOOLEAN NOT NULL DEFAULT FALSE,
  triggered_at TIMESTAMPTZ
);

CREATE INDEX idx_weather_triggered_dispatch_tenant_property
  ON weather_triggered_dispatch (
    tenant_id,
    property_id
  );

ALTER TABLE weather_triggered_dispatch
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE weather_triggered_dispatch
  FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_weather_triggered_dispatch
  ON weather_triggered_dispatch
  USING (
    tenant_id = current_setting('app.tenant_id')::uuid
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id')::uuid
  );
