CREATE TABLE privacy_preferences (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL,
  user_id               UUID NOT NULL,
  marketing_opt_in      BOOLEAN NOT NULL DEFAULT false,
  analytics_opt_in      BOOLEAN NOT NULL DEFAULT false,
  data_sharing_opt_in   BOOLEAN NOT NULL DEFAULT false,
  created_at            TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, user_id)
);

ALTER TABLE privacy_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_preferences FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_privacy_preferences ON privacy_preferences
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
