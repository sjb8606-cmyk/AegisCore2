import { z } from 'zod';
import { withTenantQuery } from '@platform/tenancy';
import { computePrice } from '@platform/ai-pricing';

export const PricingSchema=z.object({
  currency:z.string().default('CAD'),
  basePrice:z.number().nonnegative(),
  unit:z.string().default('unit'),
  competitorPrice:z.number().nonnegative().optional(),
  targetGrossMargin:z.number().min(0).max(1).default(0.5),
  demandFactor:z.number().positive().default(1),
  rationale:z.array(z.string()).default([]),
  evidenceRefs:z.array(z.string()).default([]),
});
export type Pricing=z.infer<typeof PricingSchema>;

export function calculateTargetPrice(input:unknown){
  const data=PricingSchema.parse(input);
  const costFloor=data.basePrice/(1-data.targetGrossMargin);
  const competitorAnchor=data.competitorPrice;
  const recommended=competitorAnchor!==undefined
    ? Math.max(costFloor, (costFloor+competitorAnchor)/2)
    : costFloor;
  return {...data,recommendedPrice:Math.round(recommended*100)/100};
}

export async function calculatePricingWithPlatformRules(tenantId:string,projectId:string,input:unknown){
  const data=PricingSchema.parse(input);
  const computed=calculateTargetPrice(data);
  const ruled=await computePrice(tenantId,{entity_id:projectId,base_price:computed.recommendedPrice,demand_factor:data.demandFactor,competitor_price:data.competitorPrice});
  return {...computed,platformRulePrice:ruled.computed_price};
}

export async function savePricing(tenantId:string,projectId:string,input:unknown){
  const data=PricingSchema.parse(input), rows=await withTenantQuery(
    'UPDATE business_projects SET pricing=$1,updated_at=now() WHERE id=$2 AND tenant_id=$3 AND deleted_at IS NULL RETURNING pricing',
    [JSON.stringify(data),projectId,tenantId],tenantId);
  if(!rows[0])throw new Error('Business project not found');
  return PricingSchema.parse(rows[0].pricing);
}
