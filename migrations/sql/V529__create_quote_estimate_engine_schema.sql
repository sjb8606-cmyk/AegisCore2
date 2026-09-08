CREATE TABLE quote_estimates (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  client_id UUID NOT NULL,
  property_size_sqft NUMERIC NOT NULL CHECK (property_size_sqft > 0),
  service_type TEXT NOT NULL,
  frequency TEXT NOT NULL CHECK (
    frequency IN (
      'weekly',
      'biweekly',
      'monthly',
      'seasonal'
    )
  ),
  base_rate NUMERIC NOT NULL CHECK (base_rate >= 0),
  adjustments JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_price NUMERIC NOT NULL CHECK (total_price >= 0),
  status TEXT NOT NULL CHECK (
    status IN (
      'draft',
      'sent',
      'accepted',
      'expired'
    )
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_quote_estimates_tenant_client
  ON quote_estimates (tenant_id, client_id);

CREATE INDEX idx_quote_estimates_tenant_status
  ON quote_estimates (tenant_id, status);

ALTER TABLE quote_estimates ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_estimates FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_quote_estimates
  ON quote_estimates
  USING (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  )
  WITH CHECK (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  );
