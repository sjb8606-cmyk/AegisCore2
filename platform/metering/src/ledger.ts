import { z } from 'zod';
import { randomUUID } from 'crypto';
import { getLogger } from '@platform/observability';
import { loadConfig } from '@platform/utils';

const logger = getLogger('metering:ledger');

const MeteringConfigSchema = z.object({
  eventTypes: z.array(z.string()),
  defaultUnit: z.string(),
  billingEnabled: z.boolean()
});

export async function recordUsage(input: any): Promise<void> {
  // 1. DYNAMIC LOAD: Read the "Product Catalog" from JSON
  const config = loadConfig('metering', MeteringConfigSchema);

  // 2. Business Rule: Reject events not in our manifest
  if (!config.eventTypes.includes(input.eventType)) {
    logger.error({ eventType: input.eventType }, '❌ REJECTED: Usage event not in allowed manifest');
    return;
  }

  logger.info({ 
    tenantId: input.tenantId, 
    type: input.eventType, 
    qty: input.quantity 
  }, '💰 Usage recorded for billing');
}
