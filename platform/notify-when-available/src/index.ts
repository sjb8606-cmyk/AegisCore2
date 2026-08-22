/**
 * platform/notify-when-available
 *
 * One-shot watch: subscribe → condition met → notify once → clear.
 * Distinct from threshold-alert (ongoing). Typical: back-in-stock, slot opened.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('notify-when-available');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  conditions: z
    .record(z.string())
    .default({
      product: 'stock > 0',
      slot: 'status == available',
    }),
  maxSubscriptionsPerUser: z.number().int().positive().default(50),
});

export interface Subscription {
  id: string;
  tenantId: string;
  userId: string;
  entityType: string;
  entityId: string;
  condition: string;
  createdAt: string;
}

export interface NotificationEvent {
  id: string;
  tenantId: string;
  userId: string;
  entityType: string;
  entityId: string;
  message: string;
  createdAt: string;
}

type NotifyFn = (event: NotificationEvent) => Promise<void> | void;

const subscriptions = new Map<string, Subscription>();
const notifications = new Map<string, NotificationEvent>();
let notifyFn: NotifyFn = async () => {};

export function __resetNotifyWhenAvailableStore(): void {
  subscriptions.clear();
  notifications.clear();
  notifyFn = async () => {};
}

export function setNotifyFn(fn: NotifyFn): void {
  notifyFn = fn;
}

function subKey(
  tenantId: string,
  userId: string,
  entityType: string,
  entityId: string,
): string {
  return tenantId + ':' + userId + ':' + entityType + ':' + entityId;
}

async function loadCfg() {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('notify-when-available', ConfigSchema);
}

/** Minimal expression eval for stock/status conditions */
export function evaluateCondition(
  condition: string,
  context: Record<string, unknown>,
): boolean {
  // stock > 0
  const stockGt = condition.match(/^stock\s*>\s*(\d+)$/i);
  if (stockGt) {
    const n = Number(context.stock);
    return !Number.isNaN(n) && n > Number(stockGt[1]);
  }
  // status == available
  const statusEq = condition.match(/^status\s*==\s*(\w+)$/i);
  if (statusEq) {
    return String(context.status || '') === statusEq[1];
  }
  // price < X
  const priceLt = condition.match(/^price\s*<\s*([\d.]+)$/i);
  if (priceLt) {
    const n = Number(context.price);
    return !Number.isNaN(n) && n < Number(priceLt[1]);
  }
  // fallback: context.available === true
  if (condition === 'available' || condition === 'true') {
    return context.available === true;
  }
  return false;
}

export async function subscribe(
  tenantId: string,
  actorId: string,
  input: {
    userId: string;
    entityType: string;
    entityId: string;
    condition?: string;
  },
): Promise<Subscription> {
  return runCrudOperation({
    configName: 'notify-when-available',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      if (!input.userId || !input.entityType || !input.entityId) {
        throw new AppError(
          'userId, entityType, entityId required',
          ErrorCode.BAD_REQUEST,
        );
      }
      const k = subKey(
        tenantId,
        input.userId,
        input.entityType,
        input.entityId,
      );
      const existing = subscriptions.get(k);
      if (existing) return existing;

      const userCount = [...subscriptions.values()].filter(
        (s) => s.tenantId === tenantId && s.userId === input.userId,
      ).length;
      if (userCount >= config.maxSubscriptionsPerUser) {
        throw new AppError('Subscription limit reached', ErrorCode.FORBIDDEN);
      }

      const condition =
        input.condition ||
        config.conditions[input.entityType] ||
        'available';

      const sub: Subscription = {
        id: crypto.randomUUID(),
        tenantId,
        userId: input.userId,
        entityType: input.entityType,
        entityId: input.entityId,
        condition,
        createdAt: new Date().toISOString(),
      };
      subscriptions.set(k, sub);
      return sub;
    },
    auditAction: 'data.created',
    auditResource: 'availability_subscription',
    meterEventType: 'api_call',
  });
}

export async function unsubscribe(
  tenantId: string,
  actorId: string,
  input: { userId: string; entityType: string; entityId: string },
): Promise<{ removed: boolean }> {
  return runCrudOperation({
    configName: 'notify-when-available',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const k = subKey(
        tenantId,
        input.userId,
        input.entityType,
        input.entityId,
      );
      return { removed: subscriptions.delete(k) };
    },
    auditAction: 'data.deleted',
    auditResource: 'availability_subscription',
    meterEventType: 'api_call',
  });
}

export async function signalAvailable(
  tenantId: string,
  actorId: string,
  input: {
    entityType: string;
    entityId: string;
    context: Record<string, unknown>;
    message?: string;
  },
): Promise<{ notified: number }> {
  return runCrudOperation({
    configName: 'notify-when-available',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const matching = [...subscriptions.values()].filter(
        (s) =>
          s.tenantId === tenantId &&
          s.entityType === input.entityType &&
          s.entityId === input.entityId,
      );
      let notified = 0;
      for (const sub of matching) {
        if (!evaluateCondition(sub.condition, input.context)) continue;
        const event: NotificationEvent = {
          id: crypto.randomUUID(),
          tenantId,
          userId: sub.userId,
          entityType: sub.entityType,
          entityId: sub.entityId,
          message:
            input.message ||
            input.entityType + ' ' + input.entityId + ' is now available',
          createdAt: new Date().toISOString(),
        };
        notifications.set(event.id, event);
        await notifyFn(event);
        // one-shot: clear
        subscriptions.delete(
          subKey(tenantId, sub.userId, sub.entityType, sub.entityId),
        );
        notified++;
      }
      logger.info(
        { entityId: input.entityId, notified },
        'Availability signal processed',
      );
      return { notified };
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'availability_signal',
    meterEventType: 'api_call',
  });
}

export async function listSubscriptions(
  tenantId: string,
  userId: string,
): Promise<Subscription[]> {
  return [...subscriptions.values()].filter(
    (s) => s.tenantId === tenantId && s.userId === userId,
  );
}

export async function listNotifications(
  tenantId: string,
  userId: string,
): Promise<NotificationEvent[]> {
  return [...notifications.values()].filter(
    (n) => n.tenantId === tenantId && n.userId === userId,
  );
}
