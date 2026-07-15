-- Idempotency guards
DROP TABLE IF EXISTS progress_billings CASCADE;
DROP TABLE IF EXISTS subcontractors CASCADE;
DROP TABLE IF EXISTS change_orders CASCADE;
DROP TABLE IF EXISTS cost_items CASCADE;
DROP TABLE IF EXISTS construction_projects CASCADE;

CREATE TABLE construction_projects (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  job_number        VARCHAR(50) NOT NULL,
  client_name       VARCHAR(255) NOT NULL,
  client_email      VARCHAR(255),
  client_phone      VARCHAR(50),
  address           JSONB NOT NULL DEFAULT '{}',
  description       TEXT,
  status            VARCHAR(20) DEFAULT 'active' CHECK (status IN ('estimate','active','on_hold','completed','warranty','closed')),
  type              VARCHAR(50),
  start_date        DATE,
  end_date          DATE,
  contract_cents    BIGINT NOT NULL DEFAULT 0,
  budget_cents      BIGINT DEFAULT 0,
  billed_cents      BIGINT DEFAULT 0,
  cost_cents        BIGINT DEFAULT 0,
  margin_percent    NUMERIC,
  project_manager   UUID,
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  deleted_at        TIMESTAMP WITH TIME ZONE,
  UNIQUE(tenant_id, job_number)
);

CREATE TABLE cost_items (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  project_id      UUID NOT NULL REFERENCES construction_projects(id) ON DELETE CASCADE,
  category        VARCHAR(100) NOT NULL,
  description     VARCHAR(500) NOT NULL,
  type            VARCHAR(20) DEFAULT 'material' CHECK (type IN ('material','labour','subcontractor','equipment','overhead','other')),
  quantity        NUMERIC DEFAULT 1,
  unit            VARCHAR(30),
  unit_cost_cents BIGINT NOT NULL,
  total_cents     BIGINT NOT NULL,
  actual_cents    BIGINT DEFAULT 0,
  is_budgeted     BOOLEAN DEFAULT true,
  vendor          VARCHAR(255),
  receipt_ref     VARCHAR(255),
  incurred_at     DATE DEFAULT CURRENT_DATE,
  created_by      UUID NOT NULL,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE change_orders (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  project_id        UUID NOT NULL REFERENCES construction_projects(id),
  co_number         VARCHAR(20) NOT NULL,
  title             VARCHAR(255) NOT NULL,
  description       TEXT,
  status            VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','void')),
  amount_cents      BIGINT NOT NULL,
  reason            VARCHAR(100),
  approved_by       VARCHAR(255),
  approved_at       TIMESTAMP WITH TIME ZONE,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, co_number)
);

CREATE TABLE subcontractors (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  company_name      VARCHAR(255) NOT NULL,
  contact_name      VARCHAR(255),
  email             VARCHAR(255),
  phone             VARCHAR(50),
  trade             VARCHAR(100),
  license_number    VARCHAR(100),
  insurance_expiry  DATE,
  is_active         BOOLEAN DEFAULT true,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE progress_billings (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  project_id        UUID NOT NULL REFERENCES construction_projects(id),
  billing_number    INTEGER NOT NULL,
  period_start      DATE NOT NULL,
  period_end        DATE NOT NULL,
  percent_complete  NUMERIC NOT NULL,
  amount_cents      BIGINT NOT NULL,
  status            VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','paid')),
  invoice_id        UUID,
  submitted_at      TIMESTAMP WITH TIME ZONE,
  approved_at       TIMESTAMP WITH TIME ZONE,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, billing_number)
);

ALTER TABLE construction_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE change_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE subcontractors ENABLE ROW LEVEL SECURITY;
ALTER TABLE progress_billings ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_projects ON construction_projects USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_costs ON cost_items USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_co ON change_orders USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_subs ON subcontractors USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_billings ON progress_billings USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_projects_tenant_status ON construction_projects(tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_costs_project ON cost_items(project_id, category);
CREATE INDEX IF NOT EXISTS idx_co_project ON change_orders(project_id, status);
CREATE INDEX IF NOT EXISTS idx_billings_project ON progress_billings(project_id, billing_number);
