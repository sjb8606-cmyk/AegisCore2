CREATE TABLE dunning_sequences (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  customer_id    UUID NOT NULL,
  invoice_id     UUID NOT NULL,
  stage          SMALLINT NOT NULL DEFAULT 1 CHECK (stage BETWEEN 1 AND 5),
  status         VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'resolved', 'cancelled')),
  last_sent_at   TIMESTAMP WITH TIME ZONE,
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_dunning_sequences_tenant_customer ON dunning_sequences(tenant_id, customer_id, created_at DESC);

ALTER TABLE dunning_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE dunning_sequences FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_dunning_sequences ON dunning_sequences
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
