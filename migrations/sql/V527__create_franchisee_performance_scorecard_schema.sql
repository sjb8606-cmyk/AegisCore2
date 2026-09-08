CREATE TABLE IF NOT EXISTS franchisee_performance_scorecards (
  scorecard_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  location_id UUID NOT NULL,
  reporting_period TEXT NOT NULL,
  revenue_rank INTEGER NOT NULL,
  compliance_score NUMERIC(5,2) NOT NULL,
  customer_satisfaction_score NUMERIC(5,2) NOT NULL,
  overall_rank INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_scorecard_revenue_rank
    CHECK (revenue_rank > 0),

  CONSTRAINT chk_scorecard_compliance_score
    CHECK (
      compliance_score >= 0
      AND compliance_score <= 100
    ),

  CONSTRAINT chk_scorecard_customer_score
    CHECK (
      customer_satisfaction_score >= 0
      AND customer_satisfaction_score <= 100
    )
);

ALTER TABLE franchisee_performance_scorecards
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE franchisee_performance_scorecards
  FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_franchisee_scorecards
  ON franchisee_performance_scorecards
  USING (
    tenant_id = current_setting('app.tenant_id')::uuid
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id')::uuid
  );

CREATE UNIQUE INDEX IF NOT EXISTS
  uq_franchisee_scorecard_period
  ON franchisee_performance_scorecards (
    tenant_id,
    location_id,
    reporting_period
  );

CREATE INDEX IF NOT EXISTS
  idx_franchisee_scorecard_period
  ON franchisee_performance_scorecards (
    tenant_id,
    reporting_period
  );

CREATE INDEX IF NOT EXISTS
  idx_franchisee_scorecard_rank
  ON franchisee_performance_scorecards (
    tenant_id,
    reporting_period,
    overall_rank
  );
