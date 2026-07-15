import { z } from 'zod';
import { loadConfig, AppError, ErrorCode } from '../../utils/src/index';
import { withTenantQuery } from '../../tenancy/src/index';
import { recordUsage } from '../../metering/src/index';
import { emit as auditEmit } from '../../audit/src/index';
import { randomUUID } from 'crypto';

const ConfigSchema = z.object({
  enabled: z.boolean(),
  limits: z.object({ contacts: z.number(), deals: z.number() })
});

export async function createContact(tenantId: string, data: any) {
  const config = loadConfig('crm', ConfigSchema);
  if (!config.enabled) throw new AppError('CRM disabled', ErrorCode.FORBIDDEN);

  // 1. Quota Check (Count existing active contacts)
  const current = await withTenantQuery(
    'SELECT COUNT(*)::int as count FROM contacts WHERE tenant_id = $1 AND deleted_at IS NULL',
    [tenantId],
    tenantId
  );
  
  if (current[0].count >= config.limits.contacts) {
    throw new AppError('Contact limit reached for this tier', ErrorCode.BAD_REQUEST);
  }

  // 2. Persist
  const result = await withTenantQuery(
    'INSERT INTO contacts (id, tenant_id, first_name, last_name, email) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [randomUUID(), tenantId, data.firstName, data.lastName, data.email],
    tenantId
  );

  // 3. Audit and Meter
  await auditEmit({
    tenantId, action: 'data.created', outcome: 'success',
    actorId: 'founder', actorType: 'user', resource: 'contact'
  });

  await recordUsage({ tenantId, eventType: 'api_call', quantity: 1, idempotencyKey: `contact:${result[0].id}` });

  return result[0];
}
