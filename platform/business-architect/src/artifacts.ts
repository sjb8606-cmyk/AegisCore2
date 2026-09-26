import { randomUUID } from 'crypto';
import { withTenantQuery } from '@platform/tenancy';
import { createSnapshot } from '@platform/snapshot';
import { BusinessArtifact, ArtifactSchema } from './schemas';

import { generateText } from '@platform/ai-gateway';

export type ArtifactType='BUSINESS_PLAN'|'EXECUTIVE_SUMMARY'|'FUNDING_PACKAGE'|'LAUNCH_ROADMAP';

export async function generateBusinessPlanNarrative(input:any){
  const response=await generateText({provider:'groq',model:'llama-3.3-70b-versatile',messages:[
    {role:'system',content:'Write a professional evidence-aware business plan narrative from the supplied structured facts. Do not invent facts, numbers, competitors, funding programs, or claims. Explicitly label assumptions and unknowns. Preserve supplied figures exactly.'},
    {role:'user',content:JSON.stringify(input)},
  ],maxTokens:5000,temperature:0.2});
  return response.content;
}
export async function generateExecutiveSummaryNarrative(input:any){
  const response=await generateText({provider:'groq',model:'llama-3.3-70b-versatile',messages:[
    {role:'system',content:'Write a concise executive summary from supplied structured business data. Do not invent facts or numbers. Preserve evidence/assumption distinctions.'},
    {role:'user',content:JSON.stringify(input)},
  ],maxTokens:1200,temperature:0.2});
  return response.content;
}

export function composeBusinessPlan(input:any){
  return {title:input.name,generatedAt:new Date().toISOString(),sections:{
    executiveSummary:input.executiveSummary??null,companyOverview:input.companyOverview??null,
    problem:input.customerProblem??null,market:input.market??null,competition:input.competition??null,
    businessModel:input.businessModel??null,operations:input.operations??null,pricing:input.pricing??null,
    costs:input.costs??null,financials:input.financials??null,risks:input.risks??null,funding:input.funding??null,
  },provenance:{projectId:input.id,evidenceRefs:input.evidenceRefs??[],assumptions:input.assumptions??[]}};
}
export function composeExecutiveSummary(input:any){
  return {title:input.name,summary:input.summary??'',keyFacts:input.keyFacts??[],
    financialSnapshot:input.financials??null,risks:input.risks??[],fundingNeed:input.fundingNeed??null,
    provenance:{projectId:input.id,evidenceRefs:input.evidenceRefs??[]}};
}
export async function saveArtifact(tenantId:string,actorId:string,projectId:string,type:ArtifactType,content:any){
  const latest=await withTenantQuery('SELECT COALESCE(MAX(version),0) AS version FROM business_artifacts WHERE tenant_id=$1 AND project_id=$2 AND type=$3',[tenantId,projectId,type],tenantId);
  const version=Number(latest[0]?.version??0)+1,id=randomUUID();
  await withTenantQuery('UPDATE business_artifacts SET status=\'superseded\',updated_at=now() WHERE tenant_id=$1 AND project_id=$2 AND type=$3 AND status=\'current\'',[tenantId,projectId,type],tenantId);
  const rows=await withTenantQuery('INSERT INTO business_artifacts (id,tenant_id,project_id,type,version,status,content,source_revision) VALUES ($1,$2,$3,$4,$5,\'current\',$6,$7) RETURNING *',
    [id,tenantId,projectId,type,version,JSON.stringify(content),version],tenantId);
  await createSnapshot(tenantId,'business_artifact',id,content,actorId);
  const row=rows[0];
  return ArtifactSchema.parse({id:row.id,projectId:row.project_id,tenantId:row.tenant_id,type:row.type,version:row.version,status:row.status,content:row.content,sourceRevision:row.source_revision,createdAt:new Date(row.created_at).toISOString()});
}
export async function listArtifacts(tenantId:string,projectId:string){
  return withTenantQuery('SELECT * FROM business_artifacts WHERE tenant_id=$1 AND project_id=$2 ORDER BY type,version DESC',[tenantId,projectId],tenantId);
}
export async function generateBusinessPlanArtifact(tenantId:string,actorId:string,projectId:string){
  const project=(await withTenantQuery('SELECT * FROM business_projects WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL',[projectId,tenantId],tenantId))[0];
  if(!project)throw new Error('Business project not found');
  const competitors=await withTenantQuery('SELECT * FROM business_competitors WHERE project_id=$1 AND tenant_id=$2 ORDER BY created_at',[projectId,tenantId],tenantId);
  const funding=await withTenantQuery('SELECT * FROM business_funding_findings WHERE project_id=$1 AND tenant_id=$2 ORDER BY created_at DESC',[projectId,tenantId],tenantId);
  const financials=project.financial_model_ref?(await withTenantQuery('SELECT * FROM financial_models WHERE id=$1 AND tenant_id=$2',[project.financial_model_ref,tenantId],tenantId))[0]:null;
  const source={...project,id:project.id,name:project.name,customerProblem:project.customer_problem,market:project.market,
    competition:competitors,businessModel:project.business_model,operations:project.operations,pricing:project.pricing,costs:project.costs,
    financials,funding,risks:project.risks,assumptions:project.assumptions,evidenceRefs:project.research_refs};
  const content={...composeBusinessPlan(source),narrative:await generateBusinessPlanNarrative(source)};
  return saveArtifact(tenantId,actorId,projectId,'BUSINESS_PLAN',content);
}
export async function generateExecutiveSummaryArtifact(tenantId:string,actorId:string,projectId:string){
  const project=(await withTenantQuery('SELECT * FROM business_projects WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL',[projectId,tenantId],tenantId))[0];
  if(!project)throw new Error('Business project not found');
  const financials=project.financial_model_ref?(await withTenantQuery('SELECT * FROM financial_models WHERE id=$1 AND tenant_id=$2',[project.financial_model_ref,tenantId],tenantId))[0]:null;
  const source={id:project.id,name:project.name,summary:project.plan_sections?.executiveSummary??'',
    keyFacts:[project.idea,project.customer_problem,project.business_model],financials,risks:project.risks,fundingNeed:project.funding,evidenceRefs:project.research_refs};
  const content={...composeExecutiveSummary(source),narrative:await generateExecutiveSummaryNarrative(source)};
  return saveArtifact(tenantId,actorId,projectId,'EXECUTIVE_SUMMARY',content);
}
