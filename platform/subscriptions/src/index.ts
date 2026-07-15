import { z } from 'zod';
import { loadConfig } from '../../utils/src/index';
import { withTenantQuery } from '../../tenancy/src/index';
import { recordUsage } from '../../metering/src/index';
import { randomUUID } from 'crypto';

const ConfigSchema = z.object({
  enabled: z.boolean(),
  limits: z.object({ planCount: z.number(), trialDays: z.number() })
});

export async function createPlan(tenantId: string, name: string, priceCents: number) {
  const config = loadConfig('subscriptions', ConfigSchema);
  if (!config.enabled) throw new Error('Subscriptions disabled');

  // Check plan limits
  const current = await withTenantQuery('SELECT COUNT(*)::int FROM plans', [], tenantId);
  if (current[0].count >= config.limits.planCount) {
    throw new Error('Plan limit exceeded for this tier');
  }

  const result = await withTenantQuery(
    'INSERT INTO plans (id, tenant_id, name, price_cents) VALUES ($1, $2, $3, $4) RETURNING *',
    [randomUUID(), tenantId, name, priceCents],
    tenantId
  );
  return result[0];
}

export async function createSubscription(tenantId: string, userId: string, planId: string) {
  const config = loadConfig('subscriptions', ConfigSchema);
  if (!config.enabled) throw new Error('Subscriptions disabled');

  const result = await withTenantQuery(
    'INSERT INTO subscriptions (id, tenant_id, user_id, plan_id, status) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [randomUUID(), tenantId, userId, planId, 'active'],
    tenantId
  );

  // Meter usage (Revenue)
  await recordUsage({
    tenantId,
    eventType: 'api_call',
    quantity: 1,
    idempotencyKey: `sub:${result[0].id}`
  });

  return {
    subscriptionId: result[0].id,
    checkoutUrl: `https://checkout.stripe.com/pay/mock_session_${result[0].id}`,
    status: result[0].status
  };
}
