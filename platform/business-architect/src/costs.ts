import { z } from 'zod';
import { withTenantQuery } from '@platform/tenancy';

export const CostSchema=z.object({
  startupCosts:z.record(z.number().nonnegative()).default({}),
  monthlyOperatingCosts:z.record(z.number().nonnegative()).default({}),
  oneTimeCosts:z.record(z.number().nonnegative()).default({}),
  notes:z.array(z.string()).default([]),
  evidenceRefs:z.array(z.string()).default([]),
});
export type Costs=z.infer<typeof CostSchema>;

export async function getCosts(tenantId:string,projectId:string):Promise<Costs>{
  const rows=await withTenantQuery('SELECT costs FROM business_projects WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL',[projectId,tenantId],tenantId);
  if(!rows[0])throw new Error('Business project not found');
  return CostSchema.parse(rows[0].costs??{});
}
export async function saveCosts(tenantId:string,projectId:string,input:unknown):Promise<Costs>{
  const data=CostSchema.parse(input);
  const rows=await withTenantQuery('UPDATE business_projects SET costs=$1,updated_at=now() WHERE id=$2 AND tenant_id=$3 AND deleted_at IS NULL RETURNING costs',[JSON.stringify(data),projectId,tenantId],tenantId);
  if(!rows[0])throw new Error('Business project not found');
  return CostSchema.parse(rows[0].costs);
}
