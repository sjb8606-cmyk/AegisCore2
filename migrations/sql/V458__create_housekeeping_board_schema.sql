CREATE TABLE IF NOT EXISTS hosp_hk_room (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  room_id TEXT NOT NULL,
  room_label TEXT NOT NULL,
  status TEXT NOT NULL,
  attendant_id TEXT,
  priority TEXT NOT NULL DEFAULT 'normal',
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_hosp_hk_room
  ON hosp_hk_room(tenant_id, room_id);
CREATE INDEX IF NOT EXISTS idx_hosp_hk_status
  ON hosp_hk_room(tenant_id, status, priority);
