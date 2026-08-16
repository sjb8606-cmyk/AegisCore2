import { z } from 'zod';
import { loadConfig, AppError, ErrorCode } from '@platform/utils';
export { AppError, ErrorCode };
import { withTenantQuery } from '@platform/tenancy';
import { recordUsage } from '@platform/metering';
import { emit as auditEmit } from '@platform/audit';
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
  //
  // The real, live "contacts" table is V121's schema, not crm's own
  // original V25 schema — V121 DROPs and rebuilds the table with a
  // richer shape, including a required "type" column. Without this,
  // every call here throws a NOT NULL constraint violation against the
  // real database. data.type defaults to 'person' (the sensible default
  // for a CRM "add a contact" flow); 'organization' is the only other
  // value the real table's CHECK constraint allows.
  const contactType = data.type === 'organization' ? 'organization' : 'person';
  const result = await withTenantQuery(
    'INSERT INTO contacts (id, tenant_id, type, first_name, last_name, email) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
    [randomUUID(), tenantId, contactType, data.firstName, data.lastName, data.email],
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
