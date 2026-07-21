import { z } from 'zod';
import { createHash } from 'crypto';
import { loadConfig, AppError, ErrorCode } from '../../utils/src/index';
export { AppError, ErrorCode };
import { withTenantQuery } from '../../tenancy/src/index';
import { recordUsage } from '../../metering/src/index';

const JsonConfigSchema = z.object({
  enabled: z.boolean(),
  limits: z.object({
    maxPayloadSizeKb: z.number(),
    maxDepth: z.number()
  })
});

export async function processJsonForInsight(tenantId: string, payload: any) {
  const config = loadConfig('json-translator', JsonConfigSchema);
  if (!config.enabled) throw new AppError('JSON Inspector disabled', ErrorCode.FORBIDDEN);

  // 1. Safety Check: Payload Size
  const sizeKb = Buffer.byteLength(JSON.stringify(payload)) / 1024;
  if (sizeKb > config.limits.maxPayloadSizeKb) {
    throw new AppError(`Payload too large (${sizeKb.toFixed(1)}KB)`, ErrorCode.BAD_REQUEST);
  }

  // 2. Privacy Check: Hash the payload (Never store raw data)
  const payloadHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');

  // 3. Logic: Generate Structural Tree (Simulated)
  const keys = Object.keys(payload);
  const insight = {
    hash: payloadHash,
    rootKeys: keys,
    keyCount: keys.length,
    sizeKb: sizeKb.toFixed(2)
  };

  // 4. Metering & Billing
  await recordUsage({
    tenantId,
    eventType: 'api_call',
    quantity: 1,
    idempotencyKey: `json-ins:${payloadHash}:${Date.now()}`
  });

  return insight;
}
