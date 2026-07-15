import { z } from 'zod';
import { loadConfig, AppError, ErrorCode } from '../../utils/src/index';
import { withTenantQuery } from '../../tenancy/src/index';
import { recordUsage } from '../../metering/src/index';

const ChangelogConfigSchema = z.object({
  enabled: z.boolean(),
  tiers: z.object({
    fieldLevelHighlighting: z.boolean(),
    plainLanguageSummary: z.boolean()
  }),
  limits: z.object({ maxEntriesPerPage: z.number() })
});

export async function getTimeline(tenantId: string, entityType: string, entityId: string) {
  const config = loadConfig('change-log-ui', ChangelogConfigSchema);
  if (!config.enabled) throw new AppError('Timeline disabled', ErrorCode.FORBIDDEN);

  // 1. Simulate fetching Diffs (In production, this queries the Diff Engine)
  const simulatedDiffs = [
    { field: 'status', from: 'pending', to: 'active', actor: 'founder' },
    { field: 'priority', from: 'low', to: 'high', actor: 'admin' }
  ];

  // 2. Format for UI
  const timeline = simulatedDiffs.map(diff => ({
    label: `Changed ${diff.field}`,
    detail: config.tiers.fieldLevelHighlighting ? `From "${diff.from}" to "${diff.to}"` : 'Hidden',
    severity: diff.field === 'status' ? 'high' : 'low',
    timestamp: new Date().toISOString()
  }));

  // 3. Record the View (Audit)
  await withTenantQuery(
    'INSERT INTO change_log_views (tenant_id, entity_type, entity_id, actor_id) VALUES ($1, $2, $3, $4)',
    [tenantId, entityType, entityId, 'founder'],
    tenantId
  );

  // 4. Meter usage
  await recordUsage({
    tenantId,
    eventType: 'api_call',
    quantity: 1,
    idempotencyKey: `view-log:${entityId}:${Date.now()}`
  });

  return timeline;
}
