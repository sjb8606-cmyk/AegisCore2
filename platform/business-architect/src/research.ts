import { runResearchQuery, getFindingsForStage, flagUnverifiedClaims, RawResearchResult } from '@platform/research';

export async function ingestResearch(tenantId:string,actorId:string,projectId:string,stage:string,query:string,rawResults:RawResearchResult[]){
  return runResearchQuery(tenantId,actorId,{ideaId:projectId,stage,query,rawResults});
}
export async function getResearch(tenantId:string,projectId:string,stage:string){
  return getFindingsForStage(tenantId,projectId,stage);
}
export async function getUnverifiedResearch(tenantId:string,projectId:string){
  return flagUnverifiedClaims(tenantId,projectId);
}
