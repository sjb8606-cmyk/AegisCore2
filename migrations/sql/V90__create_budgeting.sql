-- Idempotency guards to clear any half-applied schema state
DROP TABLE IF EXISTS budget_versions CASCADE;
DROP TABLE IF EXISTS budget_approvals CASCADE;
DROP TABLE IF EXISTS budget_lines CASCADE;
DROP TABLE IF EXISTS budgets CASCADE;

CREATE TABLE budgets (
  id                  UUID PRIMARY KEY,
  tenant_id           UUID NOT NULL,
  budget_code         VARCHAR(50) NOT NULL,
  name                VARCHAR(255) NOT NULL,
  budget_type         VARCHAR(50) NOT NULL CHECK (budget_type IN ('department','project','operational','capital')),
  department_id       UUID,
  project_id          UUID,
  fiscal_year         INTEGER NOT NULL,
  total_budget_cents  BIGINT DEFAULT 0,
  status              VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','locked','rejected')),
  version_number      INTEGER DEFAULT 1,
  created_by          UUID NOT NULL,
  created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  deleted_at          TIMESTAMP WITH TIME ZONE,
  UNIQUE(tenant_id, budget_code)
);

CREATE TABLE budget_lines (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  budget_id       UUID NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  name            VARCHAR(255) NOT NULL,
  amount_cents    BIGINT NOT NULL CHECK (amount_cents >= 0)
);

CREATE TABLE budget_approvals (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  budget_id       UUID NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  approver_id     UUID NOT NULL,
  status          VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reason          TEXT,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  resolved_at     TIMESTAMP WITH TIME ZONE
);

CREATE TABLE budget_versions (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  budget_id       UUID NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  version_number  INTEGER NOT NULL CHECK (version_number > 0),
  snapshot        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_budgets ON budgets USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_budget_lines ON budget_lines USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_budget_approvals ON budget_approvals USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_budget_versions ON budget_versions USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_budgets_tenant ON budgets(tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_budget_lines_budget ON budget_lines(budget_id);
CREATE INDEX IF NOT EXISTS idx_budget_approvals_budget ON budget_approvals(budget_id);
CREATE INDEX IF NOT EXISTS idx_budget_versions_budget ON budget_versions(budget_id, version_number DESC);
