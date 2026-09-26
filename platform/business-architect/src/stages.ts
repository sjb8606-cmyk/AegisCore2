import { BusinessStage, BUSINESS_STAGES } from './schemas';

const COMPLETION_REQUIREMENTS: Record<BusinessStage, string[]> = {
  IDEA:['idea'], CUSTOMER_PROBLEM:['customerProblem'], RESEARCH:['researchEvidence'],
  COMPETITION:['competitors'], BUSINESS_MODEL:['businessModel'], OPERATIONS:['operations'],
  PRICING:['pricing'], COSTS:['costs'], FINANCIALS:['financialModelRef'], RISKS:['risks'],
  FUNDING:['funding'], PLAN:['businessPlanArtifact'], EXECUTIVE_SUMMARY:['executiveSummaryArtifact'],
  FUNDING_PACKAGE:['fundingPackageArtifact'], LAUNCH:['launchRoadmapArtifact'], OPERATE:['operatingReview'],
};
export function nextStage(stage: BusinessStage): BusinessStage | null {
  const i=BUSINESS_STAGES.indexOf(stage); return i>=0 && i< BUSINESS_STAGES.length-1 ? BUSINESS_STAGES[i+1] : null;
}
export function previousStage(stage: BusinessStage): BusinessStage | null {
  const i=BUSINESS_STAGES.indexOf(stage); return i>0 ? BUSINESS_STAGES[i-1] : null;
}
export function isStage(value:string): value is BusinessStage { return (BUSINESS_STAGES as readonly string[]).includes(value); }
export function completionRequirements(stage:BusinessStage){ return [...COMPLETION_REQUIREMENTS[stage]]; }
export function canCompleteStage(stage:BusinessStage,state:Record<string,unknown>):boolean {
  return COMPLETION_REQUIREMENTS[stage].every(k => {
    const v=state[k]; if(Array.isArray(v)) return v.length>0; if(typeof v==='string') return v.length>0;
    if(v && typeof v==='object') return Object.keys(v as object).length>0; return v!==undefined && v!==null;
  });
}
