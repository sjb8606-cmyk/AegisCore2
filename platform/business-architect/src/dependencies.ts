import { BusinessStage, BUSINESS_STAGES } from './schemas';

export const STAGE_DEPENDENCIES: Record<BusinessStage,BusinessStage[]> = {
  IDEA:[], CUSTOMER_PROBLEM:['IDEA'], RESEARCH:['CUSTOMER_PROBLEM'], COMPETITION:['RESEARCH'],
  BUSINESS_MODEL:['CUSTOMER_PROBLEM','RESEARCH','COMPETITION'], OPERATIONS:['BUSINESS_MODEL'],
  PRICING:['BUSINESS_MODEL','COMPETITION','OPERATIONS'], COSTS:['OPERATIONS','PRICING'],
  FINANCIALS:['COSTS','PRICING'], RISKS:['RESEARCH','BUSINESS_MODEL','FINANCIALS'],
  FUNDING:['FINANCIALS','RISKS','RESEARCH'], PLAN:['FUNDING','RISKS','FINANCIALS','BUSINESS_MODEL'],
  EXECUTIVE_SUMMARY:['PLAN'], FUNDING_PACKAGE:['PLAN','FUNDING','EXECUTIVE_SUMMARY'],
  LAUNCH:['PLAN','OPERATIONS','FUNDING'], OPERATE:['LAUNCH'],
};
export function affectedStages(changedStage:BusinessStage):BusinessStage[] {
  const result=new Set<BusinessStage>(), queue:BusinessStage[]=[changedStage];
  while(queue.length){ const current=queue.shift()!; for(const stage of BUSINESS_STAGES)
    if(STAGE_DEPENDENCIES[stage].includes(current) && !result.has(stage)){result.add(stage);queue.push(stage);}
  }
  return BUSINESS_STAGES.filter(s=>result.has(s));
}
export function artifactTypesAffectedBy(stage:BusinessStage):string[] {
  const affected=affectedStages(stage), types=new Set<string>();
  if(affected.includes('PLAN')||affected.includes('EXECUTIVE_SUMMARY')) types.add('BUSINESS_PLAN');
  if(affected.includes('EXECUTIVE_SUMMARY')) types.add('EXECUTIVE_SUMMARY');
  if(affected.includes('FUNDING_PACKAGE')) types.add('FUNDING_PACKAGE');
  if(affected.includes('LAUNCH')) types.add('LAUNCH_ROADMAP');
  return [...types];
}
