-- Idempotency guard to clear any half-applied schema state
DROP TABLE IF EXISTS security_incidents CASCADE;

-- Genuine tenant-scoped data (an incident concerns a specific
-- tenant's systems/data), same reasoning as pending_purges — real
-- RLS, not the bot_decisions non-RLS pattern.
CREATE TABLE security_incidents (
  id          UUID PRIMARY KEY,
  tenant_id   UUID NOT NULL,
  category    TEXT NOT NULL,
  description TEXT NOT NULL,
  status      VARCHAR(20) NOT NULL DEFAULT 'open'
              CHECK (status IN ('open', 'investigating', 'resolved')),
  timeline    JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE security_incidents ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_security_incidents ON security_incidents
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_security_incidents_status ON security_incidents(tenant_id, status);
