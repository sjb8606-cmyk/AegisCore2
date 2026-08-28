CREATE TABLE IF NOT EXISTS sch_buffer_policy (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  resource_id TEXT NOT NULL,
  before_minutes INT NOT NULL DEFAULT 0,
  after_minutes INT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sch_buffer_resource
  ON sch_buffer_policy(tenant_id, resource_id);
CREATE TABLE IF NOT EXISTS sch_travel_pair (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  from_location_id TEXT NOT NULL,
  to_location_id TEXT NOT NULL,
  travel_minutes INT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sch_travel_pair
  ON sch_travel_pair(tenant_id, from_location_id, to_location_id);
