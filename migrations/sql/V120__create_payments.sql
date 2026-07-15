DROP TABLE IF EXISTS payment_disputes CASCADE;
DROP TABLE IF EXISTS payment_webhook_events CASCADE;
DROP TABLE IF EXISTS payment_refunds CASCADE;
DROP TABLE IF EXISTS payment_intents CASCADE;
DROP TABLE IF EXISTS payment_methods CASCADE;
DROP TABLE IF EXISTS payment_providers CASCADE;

CREATE TABLE payment_providers (
  id         UUID PRIMARY KEY,
  tenant_id  UUID NOT NULL,
  provider   VARCHAR(50) NOT NULL CHECK (provider IN ('paypal', 'stripe', 'crypto')),
  active     BOOLEAN DEFAULT true NOT NULL,
  config     JSONB DEFAULT '{}' NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, provider)
);

CREATE TABLE payment_methods (
  id                 UUID PRIMARY KEY,
  tenant_id          UUID NOT NULL,
  customer_ref       UUID NOT NULL,
  provider           VARCHAR(50) NOT NULL,
  provider_method_id VARCHAR(255) NOT NULL,
  type               VARCHAR(50) NOT NULL,
  last_four          VARCHAR(4) NOT NULL,
  brand              VARCHAR(50) NOT NULL,
  expires_month      INTEGER NOT NULL,
  expires_year       INTEGER NOT NULL,
  is_default         BOOLEAN DEFAULT false NOT NULL,
  metadata           JSONB DEFAULT '{}' NOT NULL,
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, provider, provider_method_id)
);

CREATE TABLE payment_intents (
  id                 UUID PRIMARY KEY,
  tenant_id          UUID NOT NULL,
  provider           VARCHAR(50) NOT NULL,
  provider_intent_id VARCHAR(255) NOT NULL,
  idempotency_key    VARCHAR(255) NOT NULL,
  amount             NUMERIC(14,4) NOT NULL CHECK (amount > 0),
  currency           VARCHAR(10) NOT NULL DEFAULT 'USD',
  status             VARCHAR(30) NOT NULL CHECK (status IN ('pending', 'processing', 'requires_action', 'succeeded', 'canceled', 'failed')),
  payment_method_ref UUID REFERENCES payment_methods(id) ON DELETE SET NULL,
  customer_ref       UUID,
  metadata           JSONB DEFAULT '{}' NOT NULL,
  expires_at         TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, idempotency_key)
);

CREATE TABLE payment_refunds (
  id                 UUID PRIMARY KEY,
  tenant_id          UUID NOT NULL,
  intent_id          UUID NOT NULL REFERENCES payment_intents(id) ON DELETE RESTRICT,
  provider_refund_id VARCHAR(255) NOT NULL,
  amount             NUMERIC(14,4) NOT NULL CHECK (amount > 0),
  reason             VARCHAR(100),
  status             VARCHAR(30) NOT NULL CHECK (status IN ('pending','succeeded','failed')),
  metadata           JSONB DEFAULT '{}' NOT NULL,
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE payment_webhook_events (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  provider          VARCHAR(50) NOT NULL,
  event_type        VARCHAR(100) NOT NULL,
  provider_event_id VARCHAR(255) NOT NULL,
  payload           JSONB NOT NULL,
  processed         BOOLEAN DEFAULT false NOT NULL,
  processed_at      TIMESTAMP WITH TIME ZONE,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider, provider_event_id)
);

CREATE TABLE payment_disputes (
  id                  UUID PRIMARY KEY,
  tenant_id           UUID NOT NULL,
  intent_id           UUID REFERENCES payment_intents(id) ON DELETE SET NULL,
  provider_dispute_id VARCHAR(255) NOT NULL,
  status              VARCHAR(30) NOT NULL CHECK (status IN ('open','under_review','won','lost','closed')),
  amount              NUMERIC(14,4) NOT NULL,
  reason              TEXT,
  due_by              TIMESTAMP WITH TIME ZONE NOT NULL,
  metadata            JSONB DEFAULT '{}' NOT NULL,
  created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE payment_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_disputes ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_providers ON payment_providers USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_intents ON payment_intents USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_methods ON payment_methods USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_refunds ON payment_refunds USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_webhooks ON payment_webhook_events USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_disputes ON payment_disputes USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_payment_intents_lookup ON payment_intents(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_payment_methods_lookup ON payment_methods(tenant_id, customer_ref);
CREATE INDEX IF NOT EXISTS idx_payment_refunds_lookup ON payment_refunds(intent_id);
