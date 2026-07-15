-- Idempotency guards
DROP TABLE IF EXISTS saas_usage_records CASCADE;
DROP TABLE IF EXISTS saas_subscriptions CASCADE;
DROP TABLE IF EXISTS saas_entitlements CASCADE;
DROP TABLE IF EXISTS saas_plans CASCADE;

CREATE TABLE saas_plans (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  name              VARCHAR(255) NOT NULL,
  price_cents       BIGINT NOT NULL DEFAULT 0,
  interval          VARCHAR(50) DEFAULT 'month' CHECK (interval IN ('month', 'year')),
  is_active         BOOLEAN DEFAULT true,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE saas_entitlements (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  plan_id           UUID NOT NULL REFERENCES saas_plans(id) ON DELETE CASCADE,
  metric            VARCHAR(100) NOT NULL,
  limit_quantity    BIGINT NOT NULL,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(plan_id, metric)
);

CREATE TABLE saas_subscriptions (
  id                    UUID PRIMARY KEY,
  tenant_id             UUID NOT NULL,
  plan_id               UUID NOT NULL REFERENCES saas_plans(id),
  user_id               UUID NOT NULL,
  status                VARCHAR(50) DEFAULT 'active' CHECK (status IN ('trialing','active','past_due','canceled')),
  current_period_start  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  current_period_end    TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at            TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE saas_usage_records (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  subscription_id   UUID NOT NULL REFERENCES saas_subscriptions(id) ON DELETE CASCADE,
  metric            VARCHAR(100) NOT NULL,
  quantity          BIGINT NOT NULL,
  incurred_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  created_by        UUID NOT NULL
);

ALTER TABLE saas_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_usage_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_plans ON saas_plans USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_entitlements ON saas_entitlements USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_subs ON saas_subscriptions USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_usage ON saas_usage_records USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_saas_subs_tenant ON saas_subscriptions(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_saas_usage_period ON saas_usage_records(subscription_id, metric, incurred_at);
