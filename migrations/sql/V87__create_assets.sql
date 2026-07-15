-- Idempotency guards to clear any half-applied schema state
DROP TABLE IF EXISTS asset_disposals CASCADE;
DROP TABLE IF EXISTS asset_depreciation CASCADE;
DROP TABLE IF EXISTS asset_assignments CASCADE;
DROP TABLE IF EXISTS asset_maintenance CASCADE;
DROP TABLE IF EXISTS assets CASCADE;

CREATE TABLE assets (
  id                  UUID PRIMARY KEY,
  tenant_id           UUID NOT NULL,
  asset_tag           VARCHAR(100) NOT NULL,
  name                VARCHAR(255) NOT NULL,
  description         TEXT,
  category            VARCHAR(100),
  serial_number       VARCHAR(255),
  manufacturer        VARCHAR(255),
  model               VARCHAR(255),
  purchase_date       DATE,
  purchase_price      NUMERIC(12,2),
  current_value       NUMERIC(12,2),
  depreciation_method VARCHAR(50),
  status              VARCHAR(30) DEFAULT 'active' CHECK (status IN ('active','maintenance','retired','disposed','lost')),
  assigned_to         UUID,
  location_id         UUID,
  qr_code             TEXT,
  barcode             TEXT,
  metadata            JSONB DEFAULT '{}',
  created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  deleted_at          TIMESTAMP WITH TIME ZONE,
  UNIQUE(tenant_id, asset_tag)
);

CREATE TABLE asset_maintenance (
  id               UUID PRIMARY KEY,
  tenant_id        UUID NOT NULL,
  asset_id         UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  maintenance_type VARCHAR(100),
  description      TEXT,
  vendor_name      VARCHAR(255),
  cost             NUMERIC(12,2),
  performed_at     TIMESTAMP WITH TIME ZONE,
  next_due_at      TIMESTAMP WITH TIME ZONE,
  status           VARCHAR(20) DEFAULT 'scheduled' CHECK (status IN ('scheduled','in_progress','completed','cancelled')),
  created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE asset_assignments (
  id          UUID PRIMARY KEY,
  tenant_id   UUID NOT NULL,
  asset_id    UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  assigned_to UUID NOT NULL,
  assigned_by UUID NOT NULL,
  assigned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  returned_at TIMESTAMP WITH TIME ZONE,
  notes       TEXT
);

CREATE TABLE asset_depreciation (
  id                  UUID PRIMARY KEY,
  tenant_id           UUID NOT NULL,
  asset_id            UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  depreciation_date   DATE NOT NULL,
  depreciation_amount NUMERIC(12,2) NOT NULL,
  book_value          NUMERIC(12,2) NOT NULL,
  created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE asset_disposals (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  asset_id        UUID NOT NULL REFERENCES assets(id),
  disposal_method VARCHAR(50),
  disposal_reason TEXT,
  disposal_amount NUMERIC(12,2),
  approved_by     UUID,
  disposed_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_maintenance ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_depreciation ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_disposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_assets ON assets USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_maintenance ON asset_maintenance USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_assignments ON asset_assignments USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_depreciation ON asset_depreciation USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_disposals ON asset_disposals USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_assets_tenant ON assets(tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_assets_tag ON assets(tenant_id, asset_tag);
CREATE INDEX IF NOT EXISTS idx_asset_maint ON asset_maintenance(tenant_id, next_due_at);
CREATE INDEX IF NOT EXISTS idx_asset_assign ON asset_assignments(tenant_id, assigned_to);
