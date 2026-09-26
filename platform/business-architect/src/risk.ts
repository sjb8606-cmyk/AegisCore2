import { buildRiskRegister, runRedTeamPass, finalizeRiskRegister } from '@platform/risk-register';
import { getUnverifiedResearch } from './research';

export async function buildBusinessRiskRegister(tenantId:string,actorId:string,projectId:string,input:any){
  const unverified=await getUnverifiedResearch(tenantId,projectId);
  return buildRiskRegister(tenantId,actorId,{
    ideaId:projectId,
    unverifiedClaims:unverified.map((x:any)=>x.claim_text),
    financialSummary:JSON.stringify(input.financialSummary??{}),
    businessModel:JSON.stringify(input.businessModel??{}),
  });
}
export { runRedTeamPass, finalizeRiskRegister };
