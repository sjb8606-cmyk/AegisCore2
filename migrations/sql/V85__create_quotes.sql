-- Idempotency guards to clear any half-applied schema state
DROP TABLE IF EXISTS quote_versions CASCADE;
DROP TABLE IF EXISTS quote_approvals CASCADE;
DROP TABLE IF EXISTS quote_lines CASCADE;
DROP TABLE IF EXISTS quotes CASCADE;

CREATE TABLE quotes (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  quote_number      VARCHAR(50) NOT NULL,
  title             VARCHAR(255) NOT NULL,
  description       TEXT,
  status            VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','approved','sent','accepted','rejected','expired')),
  total_cents       BIGINT DEFAULT 0,
  created_by        UUID NOT NULL,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  deleted_at        TIMESTAMP WITH TIME ZONE,
  UNIQUE(tenant_id, quote_number)
);

CREATE TABLE quote_lines (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  quote_id          UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  name              VARCHAR(255) NOT NULL,
  description       TEXT,
  quantity          INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents  BIGINT NOT NULL CHECK (unit_price_cents >= 0),
  discount_cents    BIGINT DEFAULT 0 CHECK (discount_cents >= 0),
  total_cents       BIGINT NOT NULL CHECK (total_cents >= 0)
);

CREATE TABLE quote_approvals (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  quote_id        UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  approver_id     UUID NOT NULL,
  status          VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reason          TEXT,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  resolved_at     TIMESTAMP WITH TIME ZONE
);

CREATE TABLE quote_versions (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  quote_id        UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  version_number  INTEGER NOT NULL CHECK (version_number > 0),
  snapshot        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_quotes ON quotes USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_quote_lines ON quote_lines USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_quote_approvals ON quote_approvals USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_quote_versions ON quote_versions USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_quotes_tenant_status ON quotes(tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_quote_lines_quote ON quote_lines(quote_id);
CREATE INDEX IF NOT EXISTS idx_quote_approvals_quote ON quote_approvals(quote_id);
CREATE INDEX IF NOT EXISTS idx_quote_versions_quote ON quote_versions(quote_id, version_number DESC);
