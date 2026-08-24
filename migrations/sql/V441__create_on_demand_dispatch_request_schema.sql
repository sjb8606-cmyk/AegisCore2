CREATE TABLE on_demand_dispatch_request (
  request_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  client_id UUID NOT NULL,
  location TEXT NOT NULL,
  urgency TEXT NOT NULL CHECK (
    urgency IN (
      'scheduled',
      'same_day',
      'emergency'
    )
  ),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  estimated_arrival TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (
    status IN (
      'pending',
      'assigned',
      'en_route',
      'arrived',
      'completed',
      'cancelled'
    )
  ),
  driver_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_on_demand_dispatch_request_tenant_status
  ON on_demand_dispatch_request (
    tenant_id,
    status
  );

CREATE INDEX idx_on_demand_dispatch_request_tenant_client
  ON on_demand_dispatch_request (
    tenant_id,
    client_id
  );

ALTER TABLE on_demand_dispatch_request
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE on_demand_dispatch_request
  FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_on_demand_dispatch_request
  ON on_demand_dispatch_request
  USING (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  )
  WITH CHECK (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  );
