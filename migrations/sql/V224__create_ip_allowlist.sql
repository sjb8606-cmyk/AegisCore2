CREATE TABLE ip_allowlist_entries (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL,
  user_id      UUID NOT NULL,
  ip_cidr      VARCHAR(50) NOT NULL,
  description  VARCHAR(500),
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, ip_cidr)
);

CREATE INDEX idx_ip_allowlist_entries_tenant_created ON ip_allowlist_entries(tenant_id, created_at DESC);

ALTER TABLE ip_allowlist_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE ip_allowlist_entries FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_ip_allowlist_entries ON ip_allowlist_entries
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
