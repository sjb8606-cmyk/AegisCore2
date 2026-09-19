import { z } from 'zod';
import { loadConfig, AppError, ErrorCode } from '../../utils/src/index';
export { AppError, ErrorCode };
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

  // Real diff engine query is not yet implemented.
  // Previously this returned hardcoded simulatedDiffs.
  throw new AppError(
    `NOT_IMPLEMENTED: getTimeline — real change-log / diff engine is not wired yet. ` +
    `Cannot return a timeline for \( {entityType}/ \){entityId}.`,
    'NOT_IMPLEMENTED'
  );
}
