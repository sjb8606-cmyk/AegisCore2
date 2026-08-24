CREATE TABLE IF NOT EXISTS salon_patch_test (
  tenant_id UUID NOT NULL,
  client_id UUID NOT NULL,
  result TEXT NOT NULL,
  tested_at TIMESTAMPTZ NOT NULL,
  notes TEXT,
  PRIMARY KEY (tenant_id, client_id, tested_at)
);
CREATE TABLE IF NOT EXISTS salon_chemical_service (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  client_id UUID NOT NULL,
  visit_id UUID,
  stylist_id UUID NOT NULL,
  service_type TEXT NOT NULL,
  formula TEXT NOT NULL,
  developer_volume TEXT,
  products JSONB NOT NULL DEFAULT '[]',
  patch_test_at TIMESTAMPTZ,
  patch_test_result TEXT NOT NULL,
  reaction_notes TEXT,
  actor_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_chem_svc_client
  ON salon_chemical_service(tenant_id, client_id, created_at DESC);
