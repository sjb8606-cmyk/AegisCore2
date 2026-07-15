-- Idempotency guards to clear any half-applied schema state
DROP TABLE IF EXISTS transactions CASCADE;
DROP TABLE IF EXISTS offers CASCADE;
DROP TABLE IF EXISTS showings CASCADE;
DROP TABLE IF EXISTS properties CASCADE;

CREATE TABLE properties (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  agent_id          UUID NOT NULL,
  mls_number        VARCHAR(50),
  status            VARCHAR(20) DEFAULT 'active' CHECK (status IN ('draft','active','pending','sold','expired','withdrawn')),
  type              VARCHAR(30) NOT NULL CHECK (type IN ('house','condo','townhouse','land','commercial','multi-family')),
  address           JSONB NOT NULL DEFAULT '{}',
  geo_point         POINT,
  list_price_cents  BIGINT NOT NULL,
  sold_price_cents  BIGINT,
  bedrooms          INTEGER,
  bathrooms         NUMERIC,
  sqft              INTEGER,
  lot_size          VARCHAR(50),
  year_built        INTEGER,
  description       TEXT,
  features          JSONB DEFAULT '[]',
  images            JSONB DEFAULT '[]',
  virtual_tour_url  TEXT,
  listed_at         TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  sold_at           TIMESTAMP WITH TIME ZONE,
  expires_at        TIMESTAMP WITH TIME ZONE,
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  deleted_at        TIMESTAMP WITH TIME ZONE
);

CREATE TABLE showings (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  property_id       UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  agent_id          UUID NOT NULL,
  client_name       VARCHAR(255) NOT NULL,
  client_email      VARCHAR(255) NOT NULL,
  client_phone      VARCHAR(50),
  scheduled_at      TIMESTAMP WITH TIME ZONE NOT NULL,
  duration_minutes  INTEGER DEFAULT 30,
  status            VARCHAR(20) DEFAULT 'scheduled' CHECK (status IN ('scheduled','confirmed','completed','canceled','no_show')),
  notes             TEXT,
  feedback          TEXT,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE offers (
  id                    UUID PRIMARY KEY,
  tenant_id             UUID NOT NULL,
  property_id           UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  buyer_name            VARCHAR(255) NOT NULL,
  buyer_email           VARCHAR(255) NOT NULL,
  amount_cents          BIGINT NOT NULL,
  deposit_cents         BIGINT,
  conditions            JSONB DEFAULT '[]',
  closing_date          DATE,
  status                VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','countered','expired','withdrawn')),
  counter_amount_cents  BIGINT,
  expires_at            TIMESTAMP WITH TIME ZONE,
  accepted_at           TIMESTAMP WITH TIME ZONE,
  notes                 TEXT,
  created_at            TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE transactions (
  id                  UUID PRIMARY KEY,
  tenant_id           UUID NOT NULL,
  property_id         UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  offer_id            UUID REFERENCES offers(id) ON DELETE SET NULL,
  status              VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open','conditions_met','firm','closing','closed','fallen_through')),
  sale_price_cents    BIGINT NOT NULL,
  commission_percent  NUMERIC DEFAULT 2.5,
  commission_cents    BIGINT,
  closing_date        DATE,
  conditions          JSONB DEFAULT '[]',
  milestones          JSONB DEFAULT '[]',
  notes               TEXT,
  closed_at           TIMESTAMP WITH TIME ZONE,
  created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE showings ENABLE ROW LEVEL SECURITY;
ALTER TABLE offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_properties ON properties USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_showings ON showings USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_offers ON offers USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_transactions ON transactions USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_properties_tenant_status ON properties(tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_properties_geo ON properties USING GIST(geo_point);
CREATE INDEX IF NOT EXISTS idx_showings_property ON showings(property_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_offers_property ON offers(property_id, status);
CREATE INDEX IF NOT EXISTS idx_transactions_tenant ON transactions(tenant_id, status);
