-- Idempotency guards to clear any half-applied schema state
DROP TABLE IF EXISTS disputes CASCADE;
DROP TABLE IF EXISTS tax_records CASCADE;
DROP TABLE IF EXISTS saved_payment_methods CASCADE;
DROP TABLE IF EXISTS dunning_attempts CASCADE;
DROP TABLE IF EXISTS dunning_records CASCADE;

CREATE TABLE dunning_records (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  payment_id      UUID NOT NULL,
  subscription_id UUID,
  status          VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','recovered','canceled','exhausted')),
  attempt_count   INTEGER DEFAULT 0,
  max_attempts    INTEGER NOT NULL,
  next_retry_at   TIMESTAMP WITH TIME ZONE,
  recovered_at    TIMESTAMP WITH TIME ZONE,
  canceled_at     TIMESTAMP WITH TIME ZONE,
  amount_cents    BIGINT NOT NULL,
  currency        VARCHAR(3) DEFAULT 'USD',
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE dunning_attempts (
  id            UUID PRIMARY KEY,
  tenant_id     UUID NOT NULL,
  dunning_id    UUID NOT NULL REFERENCES dunning_records(id) ON DELETE CASCADE,
  attempt_num   INTEGER NOT NULL,
  status        VARCHAR(20) NOT NULL CHECK (status IN ('success','failed','pending')),
  error         TEXT,
  attempted_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE saved_payment_methods (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  user_id         UUID NOT NULL,
  stripe_pm_id    VARCHAR(255) NOT NULL,
  type            VARCHAR(30) NOT NULL,
  last4           VARCHAR(4),
  brand           VARCHAR(30),
  exp_month       INTEGER,
  exp_year        INTEGER,
  is_default      BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  deleted_at      TIMESTAMP WITH TIME ZONE,
  UNIQUE(tenant_id, stripe_pm_id)
);

CREATE TABLE tax_records (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  payment_id      UUID NOT NULL,
  jurisdiction    VARCHAR(100),
  rate            NUMERIC NOT NULL,
  amount_cents    BIGINT NOT NULL,
  currency        VARCHAR(3) DEFAULT 'USD',
  collected_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE disputes (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  payment_id      UUID NOT NULL,
  stripe_dis_id   VARCHAR(255),
  reason          VARCHAR(100),
  status          VARCHAR(30) DEFAULT 'warning_needs_response',
  amount_cents    BIGINT NOT NULL,
  evidence        JSONB DEFAULT '{}',
  due_by          TIMESTAMP WITH TIME ZONE,
  resolved_at     TIMESTAMP WITH TIME ZONE,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE dunning_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE dunning_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_dunning ON dunning_records USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_attempts ON dunning_attempts USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_methods ON saved_payment_methods USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_tax ON tax_records USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_disputes ON disputes USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_dunning_retry ON dunning_records(next_retry_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_dunning_tenant ON dunning_records(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_saved_pm_user ON saved_payment_methods(tenant_id, user_id, is_default);
CREATE INDEX IF NOT EXISTS idx_disputes_due ON disputes(due_by) WHERE status NOT IN ('won', 'lost');
