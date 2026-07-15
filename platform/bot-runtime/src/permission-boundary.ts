/**
 * platform/bot-runtime/src/permission-boundary.ts
 *
 * Wraps every bot action. If the action isn't declared in the bot's
 * permissionScope, it's blocked, logged to the audit trail, and thrown
 * as an error — never silently allowed.
 */

import { AppError, ErrorCode } from '@platform/utils';
import { emit as auditEmit } from '@platform/audit';
import { getLogger } from '@platform/observability';
import { BotSpecification } from '@platform/bot-registry';

const logger = getLogger('bot-runtime:permission-boundary');
const SYSTEM_TENANT_ID = process.env.AEGIS_SYSTEM_TENANT_ID || 'system';

function scopeAllows(scope: string[], action: string): boolean {
  return scope.some((entry) => {
    if (entry === action) return true;
    if (entry.endsWith(':*')) {
      const prefix = entry.slice(0, -1);
      return action.startsWith(prefix);
    }
    return false;
  });
}

export async function enforcePermissionBoundary(
  spec: BotSpecification,
  action: string,
  context?: Record<string, unknown>,
): Promise<void> {
  if (scopeAllows(spec.permissionScope, action)) {
    return;
  }

  const reason = `Bot "${spec.proposedBotId}" attempted action "${action}" outside its declared permissionScope`;
  logger.error({ botId: spec.proposedBotId, action, scope: spec.permissionScope }, reason);

  await auditEmit({
    tenantId: SYSTEM_TENANT_ID,
    actorId: spec.proposedBotId,
    actorType: 'service',
    action: 'bot.action_blocked',
    outcome: 'failure',
    resource: 'bot_action',
    resourceId: action,
    description: reason,
    metadata: { permissionScope: spec.permissionScope, context },
  });

  throw new AppError(reason, ErrorCode.FORBIDDEN);
}
