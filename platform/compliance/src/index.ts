import { z } from 'zod';
import { loadConfig } from '../../utils/src/index';
import { withTenantQuery } from '../../tenancy/src/index';
import { emit as auditEmit } from '../../audit/src/index';
import { enqueue } from '../../queues/src/index';

const ConfigSchema = z.object({
  enabled: z.boolean(),
  limits: z.object({ requestResponseDays: z.number() }),
  queueUrl: z.string(),
});

export type DataRequestType = 'gdpr_export' | 'gdpr_deletion';

const REQUEST_TYPE_TO_AUDIT_ACTION: Record<DataRequestType, 'compliance.gdpr_export' | 'compliance.gdpr_deletion'> = {
  gdpr_export:   'compliance.gdpr_export',
  gdpr_deletion: 'compliance.gdpr_deletion',
};

export async function submitDataRequest(tenantId: string, userId: string, requestType: DataRequestType) {
  const config = loadConfig('compliance', ConfigSchema);
  if (!config.enabled) throw new Error('Compliance feature disabled');

  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + config.limits.requestResponseDays);

  const result = await withTenantQuery(
    'INSERT INTO data_requests (tenant_id, user_id, request_type, due_date) VALUES ($1, $2, $3, $4) RETURNING *',
    [tenantId, userId, requestType, dueDate.toISOString()],
    tenantId
  );

  if (!result || result.length === 0) {
    throw new Error('Failed to record data request');
  }

  const dataRequest = result[0];

  await auditEmit({
    tenantId,
    action: REQUEST_TYPE_TO_AUDIT_ACTION[requestType],
    outcome: 'success',
    actorId: userId,
    actorType: 'user',
    resource: 'data_request'
  });

  await enqueue({
    queueUrl: config.queueUrl,
    body: JSON.stringify({
      dataRequestId: dataRequest.id,
      tenantId,
      userId,
      requestType,
      dueDate: dueDate.toISOString(),
    }),
    deduplicationId: dataRequest.id,
    attributes: {
      requestType,
      tenantId,
    },
  });

  return dataRequest;
}
