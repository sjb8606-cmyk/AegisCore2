import { createFinancialModel, runSensitivity } from '@platform/financial-modeling';
import { CostSchema } from './costs';

export async function calculateFinancials(tenantId:string,actorId:string,projectId:string,input:any){
  const costs=CostSchema.parse(input.costs);
  return createFinancialModel(tenantId,actorId,{
    ideaId:projectId,
    startupCosts:costs.startupCosts,
    operatingCosts:costs.monthlyOperatingCosts,
    revenueAssumptions:{monthlyRevenueRampCad:input.monthlyRevenueRampCad},
  });
}
export async function calculateFinancialSensitivity(tenantId:string,actorId:string,projectId:string,input:any){
  const costs=CostSchema.parse(input.costs);
  return runSensitivity(tenantId,actorId,{
    modelId:input.modelId, startupCosts:costs.startupCosts, operatingCosts:costs.monthlyOperatingCosts,
    revenueAssumptions:{monthlyRevenueRampCad:input.monthlyRevenueRampCad}, scenarios:input.scenarios,
  });
}
