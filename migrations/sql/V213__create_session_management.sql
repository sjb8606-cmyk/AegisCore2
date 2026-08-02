CREATE TABLE active_sessions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  user_id        UUID NOT NULL,
  device_info    VARCHAR(500),
  ip_address     VARCHAR(45),
  last_active_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  revoked_at     TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_active_sessions_tenant_user ON active_sessions(tenant_id, user_id, last_active_at DESC);

ALTER TABLE active_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE active_sessions FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_active_sessions ON active_sessions
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
