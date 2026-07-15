-- Idempotency guards to clear any half-applied schema state
DROP TABLE IF EXISTS moderation_actions CASCADE;
DROP TABLE IF EXISTS moderation_items CASCADE;

CREATE TABLE moderation_items (
  id                  UUID PRIMARY KEY,
  tenant_id           UUID NOT NULL,
  content_type        VARCHAR(100) NOT NULL,
  content_id          UUID NOT NULL,
  content_text        TEXT NOT NULL,
  status              VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','review')),
  score               NUMERIC NOT NULL,
  categories_failed   TEXT[] DEFAULT '{}',
  created_by          UUID,
  created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE moderation_actions (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  moderation_id   UUID NOT NULL REFERENCES moderation_items(id) ON DELETE CASCADE,
  action          VARCHAR(20) NOT NULL CHECK (action IN ('approve','reject','review')),
  reason          TEXT NOT NULL,
  processed_by    UUID NOT NULL,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE moderation_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE moderation_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_moderations ON moderation_items USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_actions ON moderation_actions USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_moderations_tenant ON moderation_items(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_actions_moderation ON moderation_actions(moderation_id);
