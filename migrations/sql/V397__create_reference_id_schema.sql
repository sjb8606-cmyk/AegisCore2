CREATE TABLE IF NOT EXISTS id_sequence (
  tenant_id UUID NOT NULL,
  prefix TEXT NOT NULL,
  date_key TEXT NOT NULL,
  counter INT NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, prefix, date_key)
);
CREATE TABLE IF NOT EXISTS issued_reference (
  tenant_id UUID NOT NULL,
  ref_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, ref_id)
);
