/**
 * platform/aegis-swarm/src/lib/crm-store.ts
 *
 * ⚠️ CONTRACT: every function here takes tenantId as a bare parameter
 * with NO internal verification. Same rule as incident-store.ts and
 * purge-store.ts: whoever calls these functions MUST derive tenantId
 * from verified auth context, NEVER from a raw client header or
 * other unverified input. That exact mistake was already found and
 * fixed across 89 files elsewhere in this repo; don't reintroduce it
 * here.
 *
 * Real, tenant-scoped (RLS-protected) storage for CRM leads. Stage
 * transitions are guarded by the real pipeline state machine in
 * crm-manager.ts before this store is ever called — this module
 * itself does not re-validate transitions, same separation of
 * concerns as incident-store's SQL-level guard vs. application-level
 * lifecycle logic.
 *
 * Table: migrations/sql/V270__create_crm_leads.sql
 */

import { randomUUID } from 'crypto';
import { withTenantQuery } from '@platform/tenancy';

export type LeadStage = 'new' | 'contacted' | 'qualified' | 'proposal_sent' | 'won' | 'lost';

export interface CrmLead {
  id: string;
  tenantId: string;
  companyName: string;
  contactName: string;
  contactEmail: string | null;
  stage: LeadStage;
  estimatedValue: number | null;
  source: string | null;
  notes: string | null;
}

export interface NewLeadInput {
  companyName: string;
  contactName: string;
  contactEmail?: string;
  estimatedValue?: number;
  source?: string;
  notes?: string;
}

export async function createLead(tenantId: string, input: NewLeadInput): Promise<CrmLead> {
  const id = randomUUID();
  const result = await withTenantQuery(
    tenantId,
    `INSERT INTO crm_leads (id, tenant_id, company_name, contact_name, contact_email, estimated_value, source, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [id, tenantId, input.companyName, input.contactName, input.contactEmail ?? null, input.estimatedValue ?? null, input.source ?? null, input.notes ?? null],
  );
  return mapRow(result.rows[0]);
}

export async function getLead(tenantId: string, leadId: string): Promise<CrmLead | null> {
  const result = await withTenantQuery(tenantId, `SELECT * FROM crm_leads WHERE id = $1`, [leadId]);
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

export async function listLeadsByStage(tenantId: string, stage: LeadStage): Promise<CrmLead[]> {
  const result = await withTenantQuery(tenantId, `SELECT * FROM crm_leads WHERE stage = $1 ORDER BY created_at DESC`, [stage]);
  return result.rows.map(mapRow);
}

export async function updateLeadStage(tenantId: string, leadId: string, newStage: LeadStage): Promise<CrmLead | null> {
  const result = await withTenantQuery(
    tenantId,
    `UPDATE crm_leads SET stage = $1, updated_at = now() WHERE id = $2 RETURNING *`,
    [newStage, leadId],
  );
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

function mapRow(row: any): CrmLead {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    companyName: row.company_name,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    stage: row.stage,
    estimatedValue: row.estimated_value !== null ? Number(row.estimated_value) : null,
    source: row.source,
    notes: row.notes,
  };
}
