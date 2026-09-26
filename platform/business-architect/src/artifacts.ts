import { randomUUID } from 'crypto';
import { withTenantQuery } from '@platform/tenancy';
import { createSnapshot } from '@platform/snapshot';
import { BusinessArtifact, ArtifactSchema } from './schemas';

export type ArtifactType='BUSINESS_PLAN'|'EXECUTIVE_SUMMARY'|'FUNDING_PACKAGE'|'LAUNCH_ROADMAP';

export function composeBusinessPlan(input:any){
  return {
    title:input.name,
    generatedAt:new Date().toISOString(),
    sections:{
      executiveSummary:input.executiveSummary??null, companyOverview:input.companyOverview??null,
      problem:input.customerProblem??null, market:input.market??null, competition:input.competition??null,
      businessModel:input.businessModel??null, operations:input.operations??null, pricing:input.pricing??null,
      costs:input.costs??null, financials:input.financials??null, risks:input.risks??null, funding:input.funding??null,
    },
    provenance:{projectId:input.id,evidenceRefs:input.evidenceRefs??[],assumptions:input.assumptions??[]},
  };
}
export function composeExecutiveSummary(input:any){
  return {title:input.name,summary:input.summary??'',keyFacts:input.keyFacts??[],financialSnapshot:input.financials??null,
    risks:input.risks??[],fundingNeed:input.fundingNeed??null,provenance:{projectId:input.id,evidenceRefs:input.evidenceRefs??[]}};
}
export async function saveArtifact(tenantId:string,actorId:string,projectId:string,type:ArtifactType,content:any){
  const latest=await withTenantQuery('SELECT COALESCE(MAX(version),0) AS version FROM business_artifacts WHERE tenant_id=$1 AND project_id=$2 AND type=$3',[tenantId,projectId,type],tenantId);
  const version=Number(latest[0]?.version??0)+1,id=randomUUID();
  await withTenantQuery('UPDATE business_artifacts SET status=\'superseded\',updated_at=now() WHERE tenant_id=$1 AND project_id=$2 AND type=$3 AND status=\'current\'',[tenantId,projectId,type],tenantId);
  const rows=await withTenantQuery(
    'INSERT INTO business_artifacts (id,tenant_id,project_id,type,version,status,content,source_revision) VALUES ($1,$2,$3,$4,$5,\'current\',$6,$7) RETURNING *',
    [id,tenantId,projectId,type,version,JSON.stringify(content),version],tenantId);
  await createSnapshot(tenantId,'business_artifact',id,content,actorId);
  const row=rows[0];
  return ArtifactSchema.parse({id:row.id,projectId:row.project_id,tenantId:row.tenant_id,type:row.type,version:row.version,status:row.status,content:row.content,sourceRevision:row.source_revision,createdAt:new Date(row.created_at).toISOString()});
}
export async function listArtifacts(tenantId:string,projectId:string){
  return withTenantQuery('SELECT * FROM business_artifacts WHERE tenant_id=$1 AND project_id=$2 ORDER BY type,version DESC',[tenantId,projectId],tenantId);
}
