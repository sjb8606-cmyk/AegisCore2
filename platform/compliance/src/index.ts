import { z } from 'zod';
import { loadConfig } from '../../utils/src/index';
import { withTenantQuery } from '../../tenancy/src/index';
import { emit as auditEmit } from '../../audit/src/index';

const ConfigSchema = z.object({
  enabled: z.boolean(),
  limits: z.object({ requestResponseDays: z.number() })
});

export type DataRequestType = 'gdpr_export' | 'gdpr_deletion';

const REQUEST_TYPE_TO_AUDIT_ACTION: Record<DataRequestType, 'compliance.gdpr_export' | 'compliance.gdpr_deletion'> = {
  gdpr_export:   'compliance.gdpr_export',
  gdpr_deletion: 'compliance.gdpr_deletion',
};

export async function submitDataRequest(tenantId: string, userId: string, requestType: DataRequestType) {
  const config = loadConfig('compliance', ConfigSchema);
  if (!config.enabled) throw new Error('Compliance feature disabled');

  // Calculate Legal Due Date
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + config.limits.requestResponseDays);

  // Record Request
  const result = await withTenantQuery(
    'INSERT INTO data_requests (tenant_id, user_id, request_type, due_date) VALUES ($1, $2, $3, $4) RETURNING *',
    [tenantId, userId, requestType, dueDate.toISOString()],
    tenantId
  );

  // Audit (Mandatory for Compliance)
  await auditEmit({
    tenantId,
    action: REQUEST_TYPE_TO_AUDIT_ACTION[requestType],
    outcome: 'success',
    actorId: userId,
    actorType: 'user',
    resource: 'data_request'
  });

  // Simulated Async Queue Drop
  console.log(`⚖️  [COMPLIANCE] Queued ${requestType} job for User: ${userId}. Due by: ${dueDate.toISOString().split('T')[0]}`);

  return result[0];
}
