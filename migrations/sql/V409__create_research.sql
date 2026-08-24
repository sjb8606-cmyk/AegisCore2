-- Idempotency guards to clear any half-applied schema state
DROP TABLE IF EXISTS research_findings CASCADE;
DROP TABLE IF EXISTS research_runs CASCADE;

CREATE TABLE research_runs (
  id            UUID PRIMARY KEY,
  tenant_id     UUID NOT NULL,
  idea_id       UUID NOT NULL,
  stage         VARCHAR(100) NOT NULL,
  status        VARCHAR(20) DEFAULT 'completed' CHECK (status IN ('pending','completed','failed')),
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE research_findings (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  run_id          UUID NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
  query           TEXT NOT NULL,
  source_url      TEXT NOT NULL,
  source_title    VARCHAR(500),
  claim_text      TEXT NOT NULL,
  confidence_tag  VARCHAR(30) NOT NULL CHECK (confidence_tag IN ('known','evidence_supported','estimated','assumption','unknown')),
  retrieved_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE research_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_findings ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_research_runs ON research_runs USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_research_findings ON research_findings USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_research_runs_idea ON research_runs(tenant_id, idea_id, stage);
CREATE INDEX IF NOT EXISTS idx_research_runs_quota ON research_runs(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_research_findings_run ON research_findings(run_id);
CREATE INDEX IF NOT EXISTS idx_research_findings_confidence ON research_findings(tenant_id, confidence_tag);
