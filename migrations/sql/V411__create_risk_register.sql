-- Idempotency guards to clear any half-applied schema state
DROP TABLE IF EXISTS hiring_stages CASCADE;
DROP TABLE IF EXISTS red_team_passes CASCADE;
DROP TABLE IF EXISTS risks CASCADE;
DROP TABLE IF EXISTS risk_registers CASCADE;

CREATE TABLE risk_registers (
  id          UUID PRIMARY KEY,
  tenant_id   UUID NOT NULL,
  idea_id     UUID NOT NULL,
  status      VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft','finalized')),
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE risks (
  id                    UUID PRIMARY KEY,
  tenant_id             UUID NOT NULL,
  register_id           UUID NOT NULL REFERENCES risk_registers(id) ON DELETE CASCADE,
  description           TEXT NOT NULL,
  category              VARCHAR(30) NOT NULL CHECK (category IN ('market','financial','regulatory','operational','technical')),
  probability           VARCHAR(10) NOT NULL CHECK (probability IN ('low','med','high')),
  impact                VARCHAR(10) NOT NULL CHECK (impact IN ('low','med','high')),
  mitigation            TEXT,
  validation_required   TEXT,
  confidence_tag        VARCHAR(30) NOT NULL CHECK (confidence_tag IN ('known','evidence_supported','estimated','assumption','unknown')),
  created_at            TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE red_team_passes (
  id                       UUID PRIMARY KEY,
  tenant_id                UUID NOT NULL,
  register_id              UUID NOT NULL REFERENCES risk_registers(id) ON DELETE CASCADE,
  challenged_assumption    TEXT NOT NULL,
  attack                   TEXT NOT NULL,
  verdict                  VARCHAR(10) NOT NULL CHECK (verdict IN ('survives','weakens','kills')),
  created_at               TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE hiring_stages (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  idea_id           UUID NOT NULL,
  stage_number      INTEGER NOT NULL CHECK (stage_number > 0),
  role_title        VARCHAR(255) NOT NULL,
  skills_required   TEXT,
  trigger_condition TEXT,
  approx_headcount  INTEGER DEFAULT 1 CHECK (approx_headcount > 0),
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE risk_registers ENABLE ROW LEVEL SECURITY;
ALTER TABLE risks ENABLE ROW LEVEL SECURITY;
ALTER TABLE red_team_passes ENABLE ROW LEVEL SECURITY;
ALTER TABLE hiring_stages ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_risk_registers ON risk_registers USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_risks ON risks USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_red_team_passes ON red_team_passes USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_hiring_stages ON hiring_stages USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_risk_registers_idea ON risk_registers(tenant_id, idea_id);
CREATE INDEX IF NOT EXISTS idx_risks_register ON risks(register_id);
CREATE INDEX IF NOT EXISTS idx_risks_confidence ON risks(tenant_id, confidence_tag);
CREATE INDEX IF NOT EXISTS idx_red_team_passes_register ON red_team_passes(register_id);
CREATE INDEX IF NOT EXISTS idx_hiring_stages_idea ON hiring_stages(tenant_id, idea_id, stage_number);
