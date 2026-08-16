-- V277__create_escrow.sql
--
-- Generic escrow with a hash-chained event history (via
-- @platform/hash-chain). escrow_events.seq is a per-escrow sequence so
-- the chain has a well-defined, gap-free order to verify against.

CREATE TABLE IF NOT EXISTS escrows (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  reference_id  VARCHAR(255) NOT NULL,
  buyer_id      UUID NOT NULL,
  seller_id     UUID NOT NULL,
  amount_cents  BIGINT NOT NULL,
  currency      VARCHAR(3) NOT NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'open',
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_escrows_tenant ON escrows(tenant_id);
CREATE INDEX IF NOT EXISTS idx_escrows_buyer ON escrows(tenant_id, buyer_id);
CREATE INDEX IF NOT EXISTS idx_escrows_seller ON escrows(tenant_id, seller_id);

CREATE TABLE IF NOT EXISTS escrow_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  escrow_id      UUID NOT NULL REFERENCES escrows(id),
  seq            BIGSERIAL,
  event_type     VARCHAR(30) NOT NULL,
  payload_json   JSONB NOT NULL DEFAULT '{}',
  previous_hash  CHAR(64) NOT NULL,
  hash           CHAR(64) NOT NULL,
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_escrow_events_escrow_seq ON escrow_events(escrow_id, seq);

ALTER TABLE escrows ENABLE ROW LEVEL SECURITY;
ALTER TABLE escrows FORCE ROW LEVEL SECURITY;
ALTER TABLE escrow_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE escrow_events FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'escrows' AND policyname = 'tenant_isolation_escrows'
  ) THEN
    CREATE POLICY tenant_isolation_escrows ON escrows
      USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'escrow_events' AND policyname = 'tenant_isolation_escrow_events'
  ) THEN
    CREATE POLICY tenant_isolation_escrow_events ON escrow_events
      USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
  END IF;
END $$;
