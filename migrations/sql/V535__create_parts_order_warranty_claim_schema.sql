CREATE TABLE parts_order_warranty_claim (
  order_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  diagnosis_id UUID NOT NULL,
  part_number TEXT NOT NULL,
  part_description TEXT NOT NULL,
  cost NUMERIC(14, 2) NOT NULL
    CHECK (cost >= 0),
  covered_by_warranty BOOLEAN NOT NULL DEFAULT FALSE,
  order_status TEXT NOT NULL
    CHECK (
      order_status IN (
        'ordered',
        'backordered',
        'received',
        'installed'
      )
    ),
  warranty_claim_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_parts_order_warranty_claim_tenant_diagnosis
  ON parts_order_warranty_claim (
    tenant_id,
    diagnosis_id
  );

CREATE INDEX idx_parts_order_warranty_claim_tenant_status
  ON parts_order_warranty_claim (
    tenant_id,
    order_status
  );

ALTER TABLE parts_order_warranty_claim
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE parts_order_warranty_claim
  FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_parts_order_warranty_claim
  ON parts_order_warranty_claim
  USING (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  )
  WITH CHECK (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  );
