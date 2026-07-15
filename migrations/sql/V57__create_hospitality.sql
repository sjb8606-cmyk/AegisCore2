-- Idempotency guards
DROP TABLE IF EXISTS housekeeping_tasks CASCADE;
DROP TABLE IF EXISTS reservations CASCADE;
DROP TABLE IF EXISTS guests CASCADE;
DROP TABLE IF EXISTS rooms CASCADE;

CREATE TABLE rooms (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  room_number       VARCHAR(20) NOT NULL,
  name              VARCHAR(100),
  type              VARCHAR(50) NOT NULL,
  floor             INTEGER,
  capacity          INTEGER DEFAULT 2,
  base_rate_cents   BIGINT NOT NULL,
  currency          VARCHAR(3) DEFAULT 'USD',
  amenities         JSONB DEFAULT '[]',
  images            JSONB DEFAULT '[]',
  status            VARCHAR(20) DEFAULT 'available' CHECK (status IN ('available','occupied','cleaning','maintenance','blocked')),
  is_active         BOOLEAN DEFAULT true,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, room_number)
);

CREATE TABLE guests (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  first_name        VARCHAR(100) NOT NULL,
  last_name         VARCHAR(100) NOT NULL,
  email             VARCHAR(255),
  phone             VARCHAR(50),
  address           JSONB DEFAULT '{}',
  id_type           VARCHAR(30),
  id_number         VARCHAR(100),
  nationality       VARCHAR(50),
  notes             TEXT,
  total_stays       INTEGER DEFAULT 0,
  total_spent_cents BIGINT DEFAULT 0,
  vip_status        BOOLEAN DEFAULT false,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE reservations (
  id                    UUID PRIMARY KEY,
  tenant_id             UUID NOT NULL, 
  confirmation_number   VARCHAR(30) NOT NULL,
  room_id               UUID NOT NULL REFERENCES rooms(id),
  guest_id              UUID REFERENCES guests(id),
  guest_name            VARCHAR(255) NOT NULL,
  guest_email           VARCHAR(255) NOT NULL,
  guest_phone           VARCHAR(50),
  status                VARCHAR(20) DEFAULT 'confirmed' CHECK (status IN ('inquiry','confirmed','checked_in','checked_out','canceled','no_show')),
  check_in_date         DATE NOT NULL,
  check_out_date        DATE NOT NULL,
  nights                INTEGER NOT NULL,
  adults                INTEGER DEFAULT 1,
  children              INTEGER DEFAULT 0,
  rate_cents            BIGINT NOT NULL,
  total_cents           BIGINT NOT NULL,
  deposit_cents         BIGINT DEFAULT 0,
  balance_cents         BIGINT NOT NULL,
  payment_id            UUID,
  source                VARCHAR(30) DEFAULT 'direct',
  special_requests      TEXT,
  checked_in_at         TIMESTAMP WITH TIME ZONE,
  checked_out_at        TIMESTAMP WITH TIME ZONE,
  canceled_at           TIMESTAMP WITH TIME ZONE,
  cancel_reason         TEXT,
  metadata              JSONB DEFAULT '{}',
  created_at            TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, confirmation_number)
);

CREATE TABLE housekeeping_tasks (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  room_id         UUID NOT NULL REFERENCES rooms(id),
  type            VARCHAR(20) DEFAULT 'standard' CHECK (type IN ('standard','departure','deep','maintenance')),
  status          VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','skipped')),
  assigned_to     UUID,
  scheduled_for   DATE NOT NULL,
  priority        INTEGER DEFAULT 1,
  notes           TEXT,
  completed_at    TIMESTAMP WITH TIME ZONE,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE guests ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE housekeeping_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_rooms ON rooms USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_guests ON guests USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_reservations ON reservations USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_housekeeping ON housekeeping_tasks USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_rooms_tenant_status ON rooms(tenant_id, status, is_active);
CREATE INDEX IF NOT EXISTS idx_reservations_dates ON reservations(room_id, check_in_date, check_out_date);
CREATE INDEX IF NOT EXISTS idx_reservations_tenant ON reservations(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_housekeeping_scheduled ON housekeeping_tasks(tenant_id, scheduled_for, status);
