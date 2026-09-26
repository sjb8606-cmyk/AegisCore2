import { randomUUID } from 'crypto';
import { z } from 'zod';
import { withTenantQuery } from '@platform/tenancy';

export const FundingFindingSchema=z.object({
  title:z.string().min(1),provider:z.string().default(''),url:z.string().url().nullable().optional(),
  amount:z.string().optional(),eligibility:z.array(z.string()).default([]),
  deadlines:z.array(z.string()).default([]),status:z.enum(['candidate','verified','ineligible','expired','unknown']).default('unknown'),
  evidenceRefs:z.array(z.string()).default([]),notes:z.array(z.string()).default([]),
});
export type FundingFinding=z.infer<typeof FundingFindingSchema>;

export async function saveFundingFinding(tenantId:string,projectId:string,input:unknown){
  const data=FundingFindingSchema.parse(input),id=randomUUID();
  const rows=await withTenantQuery(
    'INSERT INTO business_funding_findings (id,tenant_id,project_id,title,provider,url,amount,eligibility,deadlines,status,evidence_refs,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *',
    [id,tenantId,projectId,data.title,data.provider,data.url??null,data.amount??null,JSON.stringify(data.eligibility),JSON.stringify(data.deadlines),data.status,JSON.stringify(data.evidenceRefs),JSON.stringify(data.notes)],tenantId);
  return rows[0];
}
export async function listFundingFindings(tenantId:string,projectId:string){
  return withTenantQuery('SELECT * FROM business_funding_findings WHERE tenant_id=$1 AND project_id=$2 ORDER BY created_at DESC',[tenantId,projectId],tenantId);
}
