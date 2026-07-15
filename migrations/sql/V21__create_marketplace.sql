CREATE EXTENSION IF NOT EXISTS earthdistance CASCADE;
CREATE EXTENSION IF NOT EXISTS cube CASCADE;

CREATE TABLE listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  seller_id UUID NOT NULL,
  title TEXT NOT NULL,
  price_cents BIGINT NOT NULL,
  status VARCHAR(20) DEFAULT 'active',
  geo_point POINT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE listings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON listings 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
