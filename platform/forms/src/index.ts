import { z } from 'zod';
import { loadConfig } from '../../utils/src/index';
import { withTenantQuery } from '../../tenancy/src/index';
import { emit as auditEmit } from '../../audit/src/index';
import { recordUsage } from '../../metering/src/index';
import { encrypt } from '../../security/src/index';

const FormsConfigSchema = z.object({
  enabled: z.boolean(),
  tiers: z.object({
    auditTrail: z.boolean(),
    encryptedSubmissions: z.boolean()
  }),
  limits: z.any()
});

export async function submitForm(tenantId: string, formId: string, data: any) {
  const config = loadConfig('forms', FormsConfigSchema);
  if (!config.enabled) throw new Error('Forms feature disabled');

  let finalPayload = JSON.stringify(data);

  // ONLY ENCRYPT IF THE JSON SAYS SO
  if (config.tiers.encryptedSubmissions) {
    console.log('🔒 Encrypting data via KMS...');
    const envelope = await encrypt(finalPayload);
    finalPayload = JSON.stringify(envelope);
  }

  // 1. Save to Database
  await withTenantQuery(
    'INSERT INTO form_submissions (form_id, tenant_id, payload) VALUES ($1, $2, $3)',
    [formId, tenantId, finalPayload],
    tenantId,
  );

  // 2. Audit
  if (config.tiers.auditTrail) {
    await auditEmit({
      tenantId,
      action: 'data.created',
      outcome: 'success',
      actorId: 'founder',
      actorType: 'user',
      resource: 'form_submission'
    });
  }

  // 3. Metering
  await recordUsage({
    tenantId,
    eventType: 'api_call',
    quantity: 1,
    idempotencyKey: `submit:${formId}:${tenantId}:${Date.now()}`
  });

  return { success: true, message: 'Data saved successfully' };
}
