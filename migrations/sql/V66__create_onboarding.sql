-- Idempotency guards to clear any half-applied schema state
DROP TABLE IF EXISTS onboarding_nudges CASCADE;
DROP TABLE IF EXISTS onboarding_progress CASCADE;
DROP TABLE IF EXISTS onboarding_flows CASCADE;

CREATE TABLE onboarding_flows (
  id               UUID PRIMARY KEY,
  tenant_id        UUID NOT NULL,
  name             VARCHAR(255) NOT NULL,
  description      TEXT,
  target_role      VARCHAR(50),
  steps            JSONB NOT NULL DEFAULT '[]',
  settings         JSONB DEFAULT '{}',
  is_active        BOOLEAN DEFAULT TRUE,
  completion_rate  NUMERIC DEFAULT 0,
  created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  deleted_at       TIMESTAMP WITH TIME ZONE
);

CREATE TABLE onboarding_progress (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  flow_id         UUID NOT NULL REFERENCES onboarding_flows(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL,
  status          VARCHAR(20) DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed','skipped','paused')),
  current_step    INTEGER DEFAULT 0,
  completed_steps INTEGER[] DEFAULT '{}',
  skipped_steps   INTEGER[] DEFAULT '{}',
  started_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  completed_at    TIMESTAMP WITH TIME ZONE,
  last_activity   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  metadata        JSONB DEFAULT '{}',
  UNIQUE(flow_id, user_id)
);

CREATE TABLE onboarding_nudges (
  id            UUID PRIMARY KEY,
  tenant_id     UUID NOT NULL,
  flow_id       UUID NOT NULL REFERENCES onboarding_flows(id) ON DELETE CASCADE,
  trigger_hours INTEGER NOT NULL,
  message       TEXT NOT NULL,
  channel       VARCHAR(20) DEFAULT 'email',
  is_active     BOOLEAN DEFAULT TRUE,
  sent_count    INTEGER DEFAULT 0,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE onboarding_flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_nudges ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_flows ON onboarding_flows USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_progress ON onboarding_progress USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_nudges ON onboarding_nudges USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_flows_tenant ON onboarding_flows(tenant_id, is_active) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_progress_user ON onboarding_progress(tenant_id, user_id, status);
CREATE INDEX IF NOT EXISTS idx_progress_flow ON onboarding_progress(flow_id, status);
CREATE INDEX IF NOT EXISTS idx_progress_stale ON onboarding_progress(last_activity) WHERE status = 'in_progress';
CREATE INDEX IF NOT EXISTS idx_nudges_flow ON onboarding_nudges(flow_id, is_active);
