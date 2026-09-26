import { randomUUID } from 'crypto';
import { withTenantQuery } from '@platform/tenancy';
import { AppError, ErrorCode } from '@platform/utils';
import { BusinessProjectSchema, ProjectCreateSchema, ProjectPatchSchema, BusinessProject, BusinessStage } from './schemas';
import { affectedStages, artifactTypesAffectedBy } from './dependencies';
import { nextStage, canCompleteStage } from './stages';

function mapProject(row:any):BusinessProject {
  return BusinessProjectSchema.parse({
    id:row.id, tenantId:row.tenant_id, name:row.name, status:row.status, currentStage:row.current_stage,
    schemaVersion:row.schema_version, founderProfile:row.founder_profile??{}, idea:row.idea??{},
    customerProblem:row.customer_problem??{}, market:row.market??{}, competition:row.competition??{},
    businessModel:row.business_model??{}, operations:row.operations??{}, pricing:row.pricing??{}, costs:row.costs??{},
    financialModelRef:row.financial_model_ref, researchRefs:row.research_refs??[], assumptions:row.assumptions??[],
    risks:row.risks??[], funding:row.funding??{}, planSections:row.plan_sections??{},
    deliverables:row.deliverables??[], decisionLog:row.decision_log??[],
    createdAt:new Date(row.created_at).toISOString(), updatedAt:new Date(row.updated_at).toISOString(),
  });
}

export async function createBusinessProject(tenantId:string, actorId:string, input:unknown):Promise<BusinessProject>{
  const data=ProjectCreateSchema.parse(input), id=randomUUID();
  const rows=await withTenantQuery(
    'INSERT INTO business_projects (id,tenant_id,name,status,current_stage,founder_profile,idea) VALUES ($1,$2,$3,$4,\'IDEA\',$5,$6) RETURNING *',
    [id,tenantId,data.name,data.status,JSON.stringify(data.founderProfile),JSON.stringify(data.idea)],tenantId);
  if(!rows[0]) throw new AppError('Business project could not be created.',ErrorCode.INTERNAL);
  return mapProject(rows[0]);
}

export async function listBusinessProjects(tenantId:string){
  return withTenantQuery('SELECT * FROM business_projects WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY updated_at DESC',[tenantId],tenantId);
}
export async function getBusinessProject(tenantId:string,projectId:string):Promise<BusinessProject>{
  const rows=await withTenantQuery('SELECT * FROM business_projects WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL',[projectId,tenantId],tenantId);
  if(!rows[0]) throw new AppError('Business project not found.',ErrorCode.NOT_FOUND);
  return mapProject(rows[0]);
}

export async function updateBusinessProject(tenantId:string,actorId:string,projectId:string,input:unknown):Promise<BusinessProject>{
  const patch=ProjectPatchSchema.parse(input), current=await getBusinessProject(tenantId,projectId), entries=Object.entries(patch);
  if(!entries.length) return current;
  const allowed:Record<string,string>={name:'name',status:'status',founderProfile:'founder_profile',idea:'idea',
    customerProblem:'customer_problem',market:'market',competition:'competition',businessModel:'business_model',
    operations:'operations',pricing:'pricing',costs:'costs',financialModelRef:'financial_model_ref',
    researchRefs:'research_refs',assumptions:'assumptions',risks:'risks',funding:'funding',
    planSections:'plan_sections',deliverables:'deliverables',decisionLog:'decision_log'};
  const setParts:string[]=[], values:any[]=[]; let i=1;
  for(const [key,value] of entries){const column=allowed[key];if(!column)continue;setParts.push(column+'=$'+i);values.push(value===null?null:(typeof value==='object'?JSON.stringify(value):value));i++;}
  if(!setParts.length) return current;
  setParts.push('updated_at=now()'); values.push(projectId,tenantId);
  const rows=await withTenantQuery('UPDATE business_projects SET '+setParts.join(', ')+' WHERE id=$'+i+' AND tenant_id=$'+(i+1)+' AND deleted_at IS NULL RETURNING *',values,tenantId);
  if(!rows[0]) throw new AppError('Business project not found.',ErrorCode.NOT_FOUND);
  const stageMap:Record<string,BusinessStage>={customerProblem:'CUSTOMER_PROBLEM',market:'RESEARCH',competition:'COMPETITION',businessModel:'BUSINESS_MODEL',operations:'OPERATIONS',pricing:'PRICING',costs:'COSTS',financialModelRef:'FINANCIALS',risks:'RISKS',funding:'FUNDING',planSections:'PLAN'};
  for(const [key] of entries){const stage=stageMap[key];if(stage) await markDownstreamArtifactsStale(tenantId,projectId,stage);}
  return mapProject(rows[0]);
}

export async function saveStageData(tenantId:string,projectId:string,stage:BusinessStage,payload:Record<string,unknown>){
  const rows=await withTenantQuery('INSERT INTO business_stage_data (id,tenant_id,project_id,stage,payload,revision) VALUES ($1,$2,$3,$4,$5,1) ON CONFLICT (tenant_id,project_id,stage) DO UPDATE SET payload=EXCLUDED.payload,revision=business_stage_data.revision+1,updated_at=now() RETURNING *',[randomUUID(),tenantId,projectId,stage,JSON.stringify(payload)],tenantId);
  return rows[0];
}
export async function getStageData(tenantId:string,projectId:string,stage:BusinessStage){
  const rows=await withTenantQuery('SELECT * FROM business_stage_data WHERE tenant_id=$1 AND project_id=$2 AND stage=$3',[tenantId,projectId,stage],tenantId);
  return rows[0]??null;
}

export async function advanceStage(tenantId:string,actorId:string,projectId:string,state:Record<string,unknown>){
  const project=await getBusinessProject(tenantId,projectId);
  if(!canCompleteStage(project.currentStage,state)) throw new AppError(
    'Current stage is not complete: structured outputs are required before advancement.',ErrorCode.BAD_REQUEST);
  await saveStageData(tenantId,projectId,project.currentStage,state);
  const next=nextStage(project.currentStage); if(!next)return project;
  await withTenantQuery('UPDATE business_projects SET current_stage=$1,updated_at=now() WHERE id=$2 AND tenant_id=$3 AND deleted_at IS NULL',
    [next,projectId,tenantId],tenantId);
  await withTenantQuery('INSERT INTO business_stage_history (id,tenant_id,project_id,from_stage,to_stage,action,completion_state,actor_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [randomUUID(),tenantId,projectId,project.currentStage,next,'advance',JSON.stringify(state),actorId],tenantId);
  return getBusinessProject(tenantId,projectId);
}

export async function revisitStage(tenantId:string,actorId:string,projectId:string,stage:BusinessStage){
  const project=await getBusinessProject(tenantId,projectId);
  await withTenantQuery('UPDATE business_projects SET current_stage=$1,updated_at=now() WHERE id=$2 AND tenant_id=$3 AND deleted_at IS NULL',[stage,projectId,tenantId],tenantId);
  await withTenantQuery('INSERT INTO business_stage_history (id,tenant_id,project_id,from_stage,to_stage,action,completion_state,actor_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [randomUUID(),tenantId,projectId,project.currentStage,stage,'revisit','{}',actorId],tenantId);
  return getBusinessProject(tenantId,projectId);
}

export async function markDownstreamArtifactsStale(tenantId:string,projectId:string,changedStage:BusinessStage){
  const types=artifactTypesAffectedBy(changedStage);
  if(!types.length)return {affectedStages:affectedStages(changedStage),artifactTypes:[]};
  await withTenantQuery('UPDATE business_artifacts SET status=\'stale\',updated_at=now() WHERE project_id=$1 AND tenant_id=$2 AND type=ANY($3::text[]) AND status=\'current\'',
    [projectId,tenantId,types],tenantId);
  return {affectedStages:affectedStages(changedStage),artifactTypes:types};
}
