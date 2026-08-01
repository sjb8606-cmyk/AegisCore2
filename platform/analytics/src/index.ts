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

  const result = await withTenantQuery(
    'INSERT INTO analytics_events (tenant_id, event_name, properties) VALUES ($1, $2, $3) RETURNING *',
    [tenantId, eventName, JSON.stringify(properties || {})],
    tenantId
  );

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

  if (!steps || steps.length === 0) {
    throw new AppError('At least one funnel step is required', ErrorCode.BAD_REQUEST);
  }

  const rows = await withTenantQuery(
    `SELECT event_name, COUNT(*)::int as count
     FROM analytics_events
     WHERE tenant_id = $1 AND event_name = ANY($2::text[])
     GROUP BY event_name`,
    [tenantId, steps],
    tenantId
  );

  const countByStep = new Map<string, number>();
  for (const row of rows || []) {
    countByStep.set(row.event_name, row.count);
  }

  const firstStepCount = countByStep.get(steps[0]) || 0;

  const funnelSteps = steps.map((step) => {
    const count = countByStep.get(step) || 0;
    const conversionRate = firstStepCount === 0
      ? 0
      : Math.round((count / firstStepCount) * 1000) / 10;
    return { step, count, conversionRate: `${conversionRate}%` };
  });

  return { steps: funnelSteps, status: 'calculated' };
}
