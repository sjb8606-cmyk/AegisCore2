import { withTenantQuery } from '@platform/tenancy';
import { BusinessModelSchema, BusinessModel } from './schemas';

export async function getBusinessModel(tenantId:string,projectId:string):Promise<BusinessModel>{
  const rows=await withTenantQuery('SELECT business_model FROM business_projects WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL',[projectId,tenantId],tenantId);
  if(!rows[0])throw new Error('Business project not found');
  return BusinessModelSchema.parse(rows[0].business_model??{});
}
export async function saveBusinessModel(tenantId:string,projectId:string,input:unknown):Promise<BusinessModel>{
  const model=BusinessModelSchema.parse(input);
  const rows=await withTenantQuery('UPDATE business_projects SET business_model=$1,updated_at=now() WHERE id=$2 AND tenant_id=$3 AND deleted_at IS NULL RETURNING business_model',[JSON.stringify(model),projectId,tenantId],tenantId);
  if(!rows[0])throw new Error('Business project not found');
  return BusinessModelSchema.parse(rows[0].business_model);
}
