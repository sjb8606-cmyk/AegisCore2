import { z } from 'zod';
import { loadConfig } from '../../utils/src/index';
import { withTenantQuery } from '../../tenancy/src/index';
import { recordUsage } from '../../metering/src/index';

const ConfigSchema = z.object({
  limits: z.object({ platformFeePercent: z.number() })
});

export async function createOrder(tenantId: string, listingId: string, amount: number) {
  const config = loadConfig('marketplace', ConfigSchema);
  
  // Calculate Fee
  const fee = Math.floor(amount * config.limits.platformFeePercent);
  
  const result = await withTenantQuery(
    'INSERT INTO orders (tenant_id, listing_id, amount_cents, fee_cents) VALUES ($1, $2, $3, $4) RETURNING *',
    [tenantId, listingId, amount, fee],
    tenantId
  );

  await recordUsage({ tenantId, eventType: 'api_call', quantity: 1, idempotencyKey: `order:${Date.now()}` });
  
  return result[0];
}
