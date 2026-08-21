CREATE TABLE IF NOT EXISTS csr_partners (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  company_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  pledged_hours_per_period NUMERIC NOT NULL,
  period TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS csr_hour_ledger (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  csr_partner_id UUID NOT NULL REFERENCES csr_partners(id),
  employee_actor_id TEXT NOT NULL,
  hours_logged NUMERIC NOT NULL,
  shift_id UUID,
  contract_id UUID,
  verified BOOLEAN NOT NULL DEFAULT false,
  period_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_csr_partners_tenant ON csr_partners(tenant_id);
CREATE INDEX IF NOT EXISTS idx_csr_ledger_partner ON csr_hour_ledger(tenant_id, csr_partner_id, period_key);
