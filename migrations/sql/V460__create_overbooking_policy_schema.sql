CREATE TABLE IF NOT EXISTS hosp_room_capacity (
  tenant_id UUID NOT NULL,
  room_type_id TEXT NOT NULL,
  stay_date DATE NOT NULL,
  physical_rooms INT NOT NULL,
  confirmed INT NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, room_type_id, stay_date)
);
CREATE TABLE IF NOT EXISTS hosp_walk_event (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  reservation_id UUID NOT NULL,
  room_type_id TEXT NOT NULL,
  stay_date DATE NOT NULL,
  reason_code TEXT NOT NULL,
  compensation_cents INT NOT NULL,
  upgrade_to_room_type_id TEXT,
  notes TEXT,
  actor_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
