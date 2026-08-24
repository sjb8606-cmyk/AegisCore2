CREATE TABLE IF NOT EXISTS damage_deposits (
  deposit_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  reservation_id UUID NOT NULL,
  deposit_amount NUMERIC(12,2) NOT NULL CHECK (deposit_amount >= 0),
  condition_at_pickup TEXT NOT NULL,
  condition_at_return TEXT,
  damage_assessed BOOLEAN NOT NULL DEFAULT FALSE,
  damage_cost NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (damage_cost >= 0),
  refund_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (refund_amount >= 0),
  status TEXT NOT NULL CHECK (
    status IN (
      'held',
      'partially_refunded',
      'fully_refunded',
      'forfeited'
    )
  ),
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE damage_deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE damage_deposits FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_damage_deposits
  ON damage_deposits
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_damage_deposits_tenant_reservation
  ON damage_deposits (tenant_id, reservation_id);

CREATE INDEX IF NOT EXISTS idx_damage_deposits_tenant_status
  ON damage_deposits (tenant_id, status);
