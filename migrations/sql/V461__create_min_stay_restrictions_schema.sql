CREATE TABLE IF NOT EXISTS hosp_date_restriction (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  room_type_id TEXT NOT NULL,
  stay_date DATE NOT NULL,
  min_stay_nights INT NOT NULL DEFAULT 1,
  closed_to_arrival BOOLEAN NOT NULL DEFAULT false,
  closed_to_departure BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_hosp_date_restriction
  ON hosp_date_restriction(tenant_id, room_type_id, stay_date);
