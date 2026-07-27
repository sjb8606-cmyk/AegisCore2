-- =============================================================================
-- Veridact — Migration V3: Coverage Boundaries, HITL Approvals, Policy Bundles
-- =============================================================================

CREATE TABLE IF NOT EXISTS policy_bundles (
  tenant_id       UUID          NOT NULL,
  rules_version   VARCHAR(128)  NOT NULL,
  rules_hash      CHAR(64)      NOT NULL,
  default_effect  VARCHAR(16)   NOT NULL,
  rules           JSONB         NOT NULL,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ   NULL,

  PRIMARY KEY (tenant_id, rules_version),
  CONSTRAINT policy_bundles_rules_hash_format CHECK (rules_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT policy_bundles_default_effect_check CHECK (default_effect IN ('ALLOW', 'DENY'))
);

CREATE INDEX IF NOT EXISTS idx_policy_bundles_tenant_id ON policy_bundles (tenant_id) WHERE deleted_at IS NULL;

ALTER TABLE policy_bundles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS policy_bundles_tenant_isolation ON policy_bundles;
CREATE POLICY policy_bundles_tenant_isolation ON policy_bundles FOR ALL
  USING (tenant_id = app.current_tenant()) WITH CHECK (tenant_id = app.current_tenant());

DROP RULE IF EXISTS policy_bundles_no_physical_delete ON policy_bundles;
CREATE RULE policy_bundles_no_physical_delete AS ON DELETE TO policy_bundles DO INSTEAD NOTHING;

CREATE TABLE IF NOT EXISTS coverage_boundaries (
  boundary_id                     VARCHAR(128)  PRIMARY KEY,
  tenant_id                       UUID          NOT NULL,
  description                     TEXT          NOT NULL,
  allowed_actions                 JSONB         NOT NULL,
  allowed_resource_patterns       JSONB         NOT NULL,
  field_constraints               JSONB         NULL,
  require_all_params_constrained  BOOLEAN       NOT NULL DEFAULT false,
  created_at                      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  deleted_at                      TIMESTAMPTZ   NULL
);

CREATE INDEX IF NOT EXISTS idx_coverage_boundaries_tenant_id ON coverage_boundaries (tenant_id) WHERE deleted_at IS NULL;

ALTER TABLE coverage_boundaries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS coverage_boundaries_tenant_isolation ON coverage_boundaries;
CREATE POLICY coverage_boundaries_tenant_isolation ON coverage_boundaries FOR ALL
  USING (tenant_id = app.current_tenant()) WITH CHECK (tenant_id = app.current_tenant());

DROP RULE IF EXISTS coverage_boundaries_no_physical_delete ON coverage_boundaries;
CREATE RULE coverage_boundaries_no_physical_delete AS ON DELETE TO coverage_boundaries DO INSTEAD NOTHING;

CREATE TABLE IF NOT EXISTS hitl_approvals (
  approval_id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID          NOT NULL,
  proposed_action        JSONB         NOT NULL,
  assigned_approver_id   VARCHAR(256)  NOT NULL,
  reason                 TEXT          NOT NULL,
  created_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  expires_at             TIMESTAMPTZ   NOT NULL,
  status                 VARCHAR(16)   NOT NULL DEFAULT 'PENDING',
  resolved_at            TIMESTAMPTZ   NULL,
  resolved_by            VARCHAR(256)  NULL,
  resolution_note        TEXT          NULL,
  deleted_at             TIMESTAMPTZ   NULL,

  CONSTRAINT hitl_approvals_status_check CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED'))
);

CREATE INDEX IF NOT EXISTS idx_hitl_approvals_tenant_id ON hitl_approvals (tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hitl_approvals_approver_status ON hitl_approvals (tenant_id, assigned_approver_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hitl_approvals_expires_at ON hitl_approvals (expires_at) WHERE status = 'PENDING' AND deleted_at IS NULL;

ALTER TABLE hitl_approvals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hitl_approvals_tenant_isolation ON hitl_approvals;
CREATE POLICY hitl_approvals_tenant_isolation ON hitl_approvals FOR ALL
  USING (tenant_id = app.current_tenant()) WITH CHECK (tenant_id = app.current_tenant());

DROP RULE IF EXISTS hitl_approvals_no_physical_delete ON hitl_approvals;
CREATE RULE hitl_approvals_no_physical_delete AS ON DELETE TO hitl_approvals DO INSTEAD NOTHING;

GRANT SELECT, INSERT, UPDATE ON policy_bundles, coverage_boundaries, hitl_approvals TO veridact_app;
