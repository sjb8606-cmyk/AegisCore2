-- V276__create_identity_tier.sql
--
-- Progressive trust-tier identity verification. Generalized from the
-- AgoraX spec's trust-tier concept for reuse across any vertical that
-- needs to gate capabilities behind verification level.

CREATE TABLE IF NOT EXISTS identity_tier_submissions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  user_id           UUID NOT NULL,
  verification_type VARCHAR(30) NOT NULL,
  tier_requested    INT NOT NULL,
  provider_ref      VARCHAR(255),
  payload_json      JSONB NOT NULL DEFAULT '{}',
  status            VARCHAR(20) NOT NULL DEFAULT 'pending',
  rejection_reason  TEXT,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  resolved_at       TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_identity_tier_submissions_tenant_user
  ON identity_tier_submissions(tenant_id, user_id);

CREATE TABLE IF NOT EXISTS identity_tiers (
  tenant_id     UUID NOT NULL,
  user_id       UUID NOT NULL,
  current_tier  INT NOT NULL DEFAULT 1,
  updated_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, user_id)
);

ALTER TABLE identity_tier_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_tier_submissions FORCE ROW LEVEL SECURITY;
ALTER TABLE identity_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_tiers FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'identity_tier_submissions' AND policyname = 'tenant_isolation_identity_tier_submissions'
  ) THEN
    CREATE POLICY tenant_isolation_identity_tier_submissions ON identity_tier_submissions
      USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'identity_tiers' AND policyname = 'tenant_isolation_identity_tiers'
  ) THEN
    CREATE POLICY tenant_isolation_identity_tiers ON identity_tiers
      USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
  END IF;
END $$;
