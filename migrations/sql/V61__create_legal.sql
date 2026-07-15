-- Idempotency guards to clear any half-applied schema state
DROP TABLE IF EXISTS trust_transactions CASCADE;
DROP TABLE IF EXISTS trust_accounts CASCADE;
DROP TABLE IF EXISTS docket_entries CASCADE;
DROP TABLE IF EXISTS time_entries CASCADE;
DROP TABLE IF EXISTS matters CASCADE;
DROP TABLE IF EXISTS legal_clients CASCADE;

CREATE TABLE legal_clients (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  type            VARCHAR(20) DEFAULT 'individual' CHECK (type IN ('individual','corporation','organization')),
  name            VARCHAR(255) NOT NULL,
  email           VARCHAR(255),
  phone           VARCHAR(50),
  address         JSONB DEFAULT '{}',
  encrypted_data  TEXT,
  conflict_names  TEXT[] DEFAULT '{}',
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  deleted_at      TIMESTAMP WITH TIME ZONE
);

CREATE TABLE matters (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  matter_number     VARCHAR(50) NOT NULL,
  client_id         UUID NOT NULL REFERENCES legal_clients(id),
  assigned_to       UUID NOT NULL,
  title             VARCHAR(255) NOT NULL,
  description       TEXT,
  practice_area     VARCHAR(100),
  status            VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open','active','on_hold','closed','archived')),
  open_date         DATE DEFAULT CURRENT_DATE,
  close_date        DATE,
  billing_type      VARCHAR(20) DEFAULT 'hourly' CHECK (billing_type IN ('hourly','flat','contingency','retainer')),
  rate_cents        BIGINT,
  estimated_hours   NUMERIC,
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  deleted_at        TIMESTAMP WITH TIME ZONE,
  UNIQUE(tenant_id, matter_number)
);

CREATE TABLE time_entries (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  matter_id       UUID NOT NULL REFERENCES matters(id),
  attorney_id     UUID NOT NULL,
  date            DATE NOT NULL DEFAULT CURRENT_DATE,
  minutes         INTEGER NOT NULL,
  rate_cents      BIGINT NOT NULL,
  amount_cents    BIGINT NOT NULL,
  description     TEXT NOT NULL,
  is_billable     BOOLEAN DEFAULT true,
  is_billed       BOOLEAN DEFAULT false,
  activity_code   VARCHAR(20),
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE docket_entries (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  matter_id       UUID NOT NULL REFERENCES matters(id),
  title           VARCHAR(500) NOT NULL,
  description     TEXT,
  due_at          TIMESTAMP WITH TIME ZONE NOT NULL,
  type            VARCHAR(30) DEFAULT 'deadline' CHECK (type IN ('deadline','hearing','filing','reminder','task')),
  status          VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','completed','missed','adjourned')),
  assigned_to     UUID,
  completed_at    TIMESTAMP WITH TIME ZONE,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE trust_accounts (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  matter_id       UUID NOT NULL REFERENCES matters(id),
  client_id       UUID NOT NULL REFERENCES legal_clients(id),
  balance_cents   BIGINT DEFAULT 0,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE trust_transactions (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  trust_account_id  UUID NOT NULL REFERENCES trust_accounts(id),
  type              VARCHAR(20) NOT NULL CHECK (type IN ('deposit','withdrawal','transfer')),
  amount_cents      BIGINT NOT NULL,
  balance_after     BIGINT NOT NULL,
  description       TEXT NOT NULL,
  reference         VARCHAR(255),
  recorded_by       UUID NOT NULL,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE legal_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE matters ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE docket_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE trust_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE trust_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_clients ON legal_clients USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_matters ON matters USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_time ON time_entries USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_docket ON docket_entries USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_trust_acct ON trust_accounts USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_trust_tx ON trust_transactions USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_matters_tenant_status ON matters(tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_matters_client ON matters(client_id);
CREATE INDEX IF NOT EXISTS idx_time_matter ON time_entries(matter_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_docket_due ON docket_entries(matter_id, due_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_trust_matter ON trust_accounts(matter_id);
