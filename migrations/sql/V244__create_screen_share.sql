CREATE TABLE screen_share_sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL,
  host_user_id UUID NOT NULL,
  title        VARCHAR(255),
  started_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at     TIMESTAMP WITH TIME ZONE,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_screen_share_sessions_tenant_host ON screen_share_sessions(tenant_id, host_user_id, created_at DESC);

ALTER TABLE screen_share_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE screen_share_sessions FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_screen_share_sessions ON screen_share_sessions
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
