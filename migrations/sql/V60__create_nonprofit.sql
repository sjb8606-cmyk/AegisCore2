-- Idempotency guards
DROP TABLE IF EXISTS campaigns CASCADE;
DROP TABLE IF EXISTS volunteer_hours CASCADE;
DROP TABLE IF EXISTS volunteers CASCADE;
DROP TABLE IF EXISTS grants CASCADE;
DROP TABLE IF EXISTS donations CASCADE;
DROP TABLE IF EXISTS donors CASCADE;

CREATE TABLE donors (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  first_name        VARCHAR(100),
  last_name         VARCHAR(100),
  organization      VARCHAR(255),
  email             VARCHAR(255),
  phone             VARCHAR(50),
  address           JSONB DEFAULT '{}',
  donor_type        VARCHAR(20) DEFAULT 'individual' CHECK (donor_type IN ('individual','corporate','foundation','government')),
  total_given_cents BIGINT DEFAULT 0,
  first_gift_at     TIMESTAMP WITH TIME ZONE,
  last_gift_at      TIMESTAMP WITH TIME ZONE,
  tags              TEXT[] DEFAULT '{}',
  notes             TEXT,
  is_anonymous      BOOLEAN DEFAULT false,
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  deleted_at        TIMESTAMP WITH TIME ZONE
);

CREATE TABLE campaigns (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  name            VARCHAR(255) NOT NULL,
  description     TEXT,
  goal_cents      BIGINT,
  raised_cents    BIGINT DEFAULT 0,
  status          VARCHAR(20) DEFAULT 'active',
  starts_at       TIMESTAMP WITH TIME ZONE,
  ends_at         TIMESTAMP WITH TIME ZONE,
  is_public       BOOLEAN DEFAULT true,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE donations (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  donor_id          UUID REFERENCES donors(id),
  campaign_id       UUID REFERENCES campaigns(id),
  amount_cents      BIGINT NOT NULL,
  currency          VARCHAR(3) DEFAULT 'CAD',
  type              VARCHAR(20) DEFAULT 'one_time' CHECK (type IN ('one_time','recurring','pledge','in_kind')),
  channel           VARCHAR(20) DEFAULT 'online',
  status            VARCHAR(20) DEFAULT 'completed',
  payment_id        UUID,
  receipt_number    VARCHAR(50),
  receipt_sent_at   TIMESTAMP WITH TIME ZONE,
  is_anonymous      BOOLEAN DEFAULT false,
  dedication        VARCHAR(255),
  notes             TEXT,
  donated_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE grants (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  funder_name       VARCHAR(255) NOT NULL,
  title             VARCHAR(255) NOT NULL,
  amount_cents      BIGINT NOT NULL,
  currency          VARCHAR(3) DEFAULT 'CAD',
  status            VARCHAR(20) DEFAULT 'prospect',
  application_date  DATE,
  decision_date     DATE,
  start_date        DATE,
  end_date          DATE,
  received_cents    BIGINT DEFAULT 0,
  spent_cents       BIGINT DEFAULT 0,
  report_due_date   DATE,
  notes             TEXT,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE volunteers (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  user_id           UUID,
  first_name        VARCHAR(100) NOT NULL,
  last_name         VARCHAR(100) NOT NULL,
  email             VARCHAR(255),
  phone             VARCHAR(50),
  skills            TEXT[] DEFAULT '{}',
  status            VARCHAR(20) DEFAULT 'active',
  total_hours       NUMERIC DEFAULT 0,
  background_check_at TIMESTAMP WITH TIME ZONE,
  notes             TEXT,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE volunteer_hours (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  volunteer_id    UUID NOT NULL REFERENCES volunteers(id),
  program_id      UUID,
  date            DATE NOT NULL,
  hours           NUMERIC NOT NULL,
  description     VARCHAR(255),
  approved_by     UUID,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE donors ENABLE ROW LEVEL SECURITY;
ALTER TABLE donations ENABLE ROW LEVEL SECURITY;
ALTER TABLE grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE volunteers ENABLE ROW LEVEL SECURITY;
ALTER TABLE volunteer_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_donors ON donors USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_donations ON donations USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_grants ON grants USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_volunteers ON volunteers USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_vol_hours ON volunteer_hours USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_campaigns ON campaigns USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_donors_tenant ON donors(tenant_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_donations_donor ON donations(donor_id, donated_at);
CREATE INDEX IF NOT EXISTS idx_donations_campaign ON donations(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_tenant ON campaigns(tenant_id, status);
