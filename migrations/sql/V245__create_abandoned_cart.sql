CREATE TABLE abandoned_carts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,
  user_id          UUID NOT NULL,
  cart_snapshot    JSONB NOT NULL DEFAULT '[]',
  total_cents      INTEGER NOT NULL CHECK (total_cents >= 0),
  recovery_sent_at TIMESTAMP WITH TIME ZONE,
  recovered_at     TIMESTAMP WITH TIME ZONE,
  created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_abandoned_carts_tenant_user ON abandoned_carts(tenant_id, user_id, created_at DESC);

ALTER TABLE abandoned_carts ENABLE ROW LEVEL SECURITY;
ALTER TABLE abandoned_carts FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_abandoned_carts ON abandoned_carts
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
