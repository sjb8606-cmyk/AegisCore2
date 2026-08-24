CREATE TABLE IF NOT EXISTS ag_certification (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  cert_type TEXT NOT NULL,
  holder_id TEXT NOT NULL,
  cert_number TEXT NOT NULL,
  issue_date TIMESTAMPTZ NOT NULL,
  expiry_date TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ag_cert_expiry
  ON ag_certification(tenant_id, expiry_date);
CREATE TABLE IF NOT EXISTS ag_inspection_report (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  field_ids JSONB NOT NULL,
  date_range JSONB NOT NULL,
  payload JSONB NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
