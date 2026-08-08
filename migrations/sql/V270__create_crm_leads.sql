-- V270__create_crm_leads.sql
-- Real CRM leads/deals table. RLS-scoped like every other tenant
-- table in this schema. Empty on creation — starts filling with real
-- rows the moment a real lead comes in.

CREATE TABLE crm_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  company_name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  contact_email TEXT,
  stage TEXT NOT NULL DEFAULT 'new' CHECK (stage IN ('new', 'contacted', 'qualified', 'proposal_sent', 'won', 'lost')),
  estimated_value NUMERIC,
  source TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_crm_leads_tenant_id ON crm_leads (tenant_id);
CREATE INDEX idx_crm_leads_stage ON crm_leads (tenant_id, stage);

ALTER TABLE crm_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY crm_leads_tenant_isolation ON crm_leads
  USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
