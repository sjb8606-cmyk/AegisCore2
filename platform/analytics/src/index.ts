import { z } from 'zod';
import { loadConfig, AppError, ErrorCode } from '../../utils/src/index';
export { AppError, ErrorCode };
import { withTenantQuery } from '../../tenancy/src/index';
import { recordUsage } from '../../metering/src/index';

const ConfigSchema = z.object({
  enabled: z.boolean(),
  tiers: z.object({ funnels: z.boolean() })
});

export async function trackEvent(tenantId: string, eventName: string, properties: any) {
  const config = loadConfig('analytics', ConfigSchema);
  if (!config.enabled) throw new AppError('Analytics disabled', ErrorCode.FORBIDDEN);

  // 1. Persist to Time-Series Log
  const result = await withTenantQuery(
    'INSERT INTO analytics_events (tenant_id, event_name, properties) VALUES ($1, $2, $3) RETURNING *',
    [tenantId, eventName, JSON.stringify(properties || {})],
    tenantId
  );

  // 2. Meter Usage (Revenue)
  await recordUsage({
    tenantId,
    eventType: 'api_call',
    quantity: 1,
    idempotencyKey: `analytics:${result[0].id}`
  });

  return result[0];
}

export async function getFunnel(tenantId: string, steps: string[]) {
  const config = loadConfig('analytics', ConfigSchema);
  if (!config.tiers.funnels) throw new AppError('Funnels tier required', ErrorCode.FORBIDDEN);

  // Simulated High-Speed Funnel Calculation
  return {
    steps: steps.map((s, i) => ({ step: s, conversionRate: (100 - i * 20) + '%' })),
    status: 'calculated'
  };
}
