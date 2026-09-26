import { z } from 'zod';
import { withTenantQuery } from '@platform/tenancy';

export const OperationsSchema=z.object({
  workflows:z.array(z.string()).default([]),
  resources:z.array(z.string()).default([]),
  staffingAssumptions:z.array(z.record(z.any())).default([]),
  dependencies:z.array(z.string()).default([]),
  regulatoryRequirements:z.array(z.string()).default([]),
  evidenceRefs:z.array(z.string()).default([]),
});
export type Operations=z.infer<typeof OperationsSchema>;

export async function getOperations(tenantId:string,projectId:string):Promise<Operations>{
  const rows=await withTenantQuery('SELECT operations FROM business_projects WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL',[projectId,tenantId],tenantId);
  if(!rows[0])throw new Error('Business project not found');
  return OperationsSchema.parse(rows[0].operations??{});
}
export async function saveOperations(tenantId:string,projectId:string,input:unknown):Promise<Operations>{
  const data=OperationsSchema.parse(input);
  const rows=await withTenantQuery('UPDATE business_projects SET operations=$1,updated_at=now() WHERE id=$2 AND tenant_id=$3 AND deleted_at IS NULL RETURNING operations',[JSON.stringify(data),projectId,tenantId],tenantId);
  if(!rows[0])throw new Error('Business project not found');
  return OperationsSchema.parse(rows[0].operations);
}
