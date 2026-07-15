-- Idempotency guards to clear any half-applied schema state
DROP TABLE IF EXISTS loyalty_tiers CASCADE;
DROP TABLE IF EXISTS reward_redemptions CASCADE;
DROP TABLE IF EXISTS rewards CASCADE;
DROP TABLE IF EXISTS points_transactions CASCADE;
DROP TABLE IF EXISTS loyalty_members CASCADE;

CREATE TABLE loyalty_members (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  user_id         UUID,
  email           VARCHAR(255) NOT NULL,
  name            VARCHAR(255),
  points_balance  BIGINT DEFAULT 0,
  lifetime_points BIGINT DEFAULT 0,
  tier            VARCHAR(50) DEFAULT 'standard',
  referral_code   VARCHAR(20) UNIQUE,
  referred_by     UUID REFERENCES loyalty_members(id),
  joined_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  last_activity   TIMESTAMP WITH TIME ZONE,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  deleted_at      TIMESTAMP WITH TIME ZONE,
  UNIQUE(tenant_id, email)
);

CREATE TABLE points_transactions (
  id            UUID PRIMARY KEY,
  tenant_id     UUID NOT NULL,
  member_id     UUID NOT NULL REFERENCES loyalty_members(id) ON DELETE CASCADE,
  type          VARCHAR(20) NOT NULL CHECK (type IN ('earn','redeem','expire','adjust','referral','bonus')),
  points        BIGINT NOT NULL,
  balance_after BIGINT NOT NULL,
  description   VARCHAR(255),
  reference     VARCHAR(255),
  expires_at    TIMESTAMP WITH TIME ZONE,
  created_by    UUID,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE rewards (
  id          UUID PRIMARY KEY,
  tenant_id   UUID NOT NULL,
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  points_cost BIGINT NOT NULL,
  type        VARCHAR(30) DEFAULT 'discount' CHECK (type IN ('discount','freeitem','experience','voucher','custom')),
  value       JSONB DEFAULT '{}',
  stock       INTEGER DEFAULT NULL,
  is_active   BOOLEAN DEFAULT TRUE,
  expires_at  TIMESTAMP WITH TIME ZONE,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  deleted_at  TIMESTAMP WITH TIME ZONE
);

CREATE TABLE reward_redemptions (
  id            UUID PRIMARY KEY,
  tenant_id     UUID NOT NULL,
  member_id     UUID NOT NULL REFERENCES loyalty_members(id) ON DELETE CASCADE,
  reward_id     UUID NOT NULL REFERENCES rewards(id) ON DELETE CASCADE,
  points_used   BIGINT NOT NULL,
  status        VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','fulfilled','expired','canceled')),
  code          VARCHAR(50) UNIQUE,
  fulfilled_at  TIMESTAMP WITH TIME ZONE,
  expires_at    TIMESTAMP WITH TIME ZONE,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE loyalty_tiers (
  id          UUID PRIMARY KEY,
  tenant_id   UUID NOT NULL,
  name        VARCHAR(50) NOT NULL,
  min_points  BIGINT NOT NULL DEFAULT 0,
  multiplier  NUMERIC DEFAULT 1.0,
  perks       JSONB DEFAULT '[]',
  color       VARCHAR(7),
  sort_order  INTEGER DEFAULT 0,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE loyalty_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE points_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE reward_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_tiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_members ON loyalty_members USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_tx ON points_transactions USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_rewards ON rewards USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_redemptions ON reward_redemptions USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_tiers ON loyalty_tiers USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_members_tenant ON loyalty_members(tenant_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_members_email ON loyalty_members(tenant_id, email);
CREATE INDEX IF NOT EXISTS idx_members_referral ON loyalty_members(referral_code);
CREATE INDEX IF NOT EXISTS idx_tx_member ON points_transactions(member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tx_expiry ON points_transactions(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rewards_tenant ON rewards(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_redemptions_member ON reward_redemptions(member_id);
CREATE INDEX IF NOT EXISTS idx_redemptions_code ON reward_redemptions(code);
