CREATE TABLE IF NOT EXISTS invoices (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  invoice_number    VARCHAR(50) NOT NULL,
  client_id         UUID,
  client_name       VARCHAR(255) NOT NULL,
  client_email      VARCHAR(255) NOT NULL,
  client_address    JSONB DEFAULT '{}',
  status            VARCHAR(20) DEFAULT 'draft'
                    CHECK (status IN ('draft','sent','viewed','partial','paid','overdue','void','canceled')),
  issue_date        DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date          DATE NOT NULL,
  subtotal_cents    BIGINT NOT NULL DEFAULT 0,
  discount_cents    BIGINT DEFAULT 0,
  tax_cents         BIGINT DEFAULT 0,
  total_cents       BIGINT NOT NULL DEFAULT 0,
  paid_cents        BIGINT DEFAULT 0,
  currency          VARCHAR(3) DEFAULT 'CAD',
  notes             TEXT,
  terms             TEXT,
  pdf_url           TEXT,
  is_recurring      BOOLEAN DEFAULT false,
  recurrence_rule   JSONB,
  parent_invoice_id UUID REFERENCES invoices(id),
  sent_at           TIMESTAMPTZ,
  viewed_at         TIMESTAMPTZ,
  paid_at           TIMESTAMPTZ,
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ,
  UNIQUE(tenant_id, invoice_number)
);

CREATE TABLE IF NOT EXISTS invoice_line_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  invoice_id  UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description VARCHAR(500) NOT NULL,
  quantity    NUMERIC NOT NULL DEFAULT 1,
  unit_price_cents BIGINT NOT NULL,
  discount_percent NUMERIC DEFAULT 0,
  tax_percent NUMERIC DEFAULT 0,
  total_cents BIGINT NOT NULL,
  sort_order  INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invoice_payments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  invoice_id  UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount_cents BIGINT NOT NULL,
  currency    VARCHAR(3) DEFAULT 'CAD',
  method      VARCHAR(50),
  reference   VARCHAR(255),
  notes       TEXT,
  paid_at     TIMESTAMPTZ DEFAULT NOW(),
  recorded_by UUID NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security Activation
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;

ALTER TABLE invoice_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_line_items FORCE ROW LEVEL SECURITY;

ALTER TABLE invoice_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_payments FORCE ROW LEVEL SECURITY;

-- Dynamic Tenant Isolation Policies
CREATE POLICY tenant_isolation_invoices ON invoices 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_line_items ON invoice_line_items 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_payments ON invoice_payments 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Core Query Optimization Indices
CREATE INDEX IF NOT EXISTS idx_invoices_tenant ON invoices(tenant_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(tenant_id, client_email);
CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(tenant_id, invoice_number);
CREATE INDEX IF NOT EXISTS idx_line_items_invoice ON invoice_line_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON invoice_payments(invoice_id);
