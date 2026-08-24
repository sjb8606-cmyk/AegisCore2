CREATE TABLE accumulation_tier_invoices (
  invoice_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  property_id UUID NOT NULL,
  accumulation_inches NUMERIC(10,2) NOT NULL
    CHECK (accumulation_inches >= 0),
  tier_applied INTEGER NOT NULL
    CHECK (tier_applied > 0),
  tier_rate NUMERIC(12,2) NOT NULL
    CHECK (tier_rate >= 0),
  total_amount NUMERIC(12,2) NOT NULL
    CHECK (total_amount >= 0)
);

CREATE INDEX idx_accumulation_tier_invoices_tenant_property
  ON accumulation_tier_invoices (
    tenant_id,
    property_id
  );

ALTER TABLE accumulation_tier_invoices
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE accumulation_tier_invoices
  FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_accumulation_tier_invoices
  ON accumulation_tier_invoices
  USING (
    tenant_id = current_setting('app.tenant_id')::uuid
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id')::uuid
  );
