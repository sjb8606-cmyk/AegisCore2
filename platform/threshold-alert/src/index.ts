/**
 * platform/threshold-alert
 *
 * Watch a metric → fire when bound crossed → track open/resolved.
 * Hysteresis avoids flap; actions are recorded (notify/webhook/workflow hooks later).
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('threshold-alert');

const Operators = ['gt', 'gte', 'lt', 'lte', 'eq'] as const;
export type Operator = (typeof Operators)[number];

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  defaultHysteresis: z.number().default(0),
  maxOpenPerTenant: z.number().int().positive().default(500),
});

export interface AlertRule {
  id: string;
  tenantId: string;
  entityType: string;
  metric: string;
  operator: Operator;
  threshold: number;
  hysteresis: number;
  action: string;
  active: boolean;
  createdAt: string;
}

export interface AlertEvent {
  id: string;
  tenantId: string;
  ruleId: string;
  entityId: string;
  metric: string;
  value: number;
  triggeredAt: string;
  resolvedAt: string | null;
  status: 'open' | 'resolved';
  actionFired: string;
}

const rules = new Map<string, AlertRule>();
const events = new Map<string, AlertEvent>();

export function __resetThresholdAlertStore(): void {
  rules.clear();
  events.clear();
}

async function loadCfg() {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('threshold-alert', ConfigSchema);
}

export function crossesThreshold(
  value: number,
  operator: Operator,
  threshold: number,
): boolean {
  switch (operator) {
    case 'gt':
      return value > threshold;
    case 'gte':
      return value >= threshold;
    case 'lt':
      return value < threshold;
    case 'lte':
      return value <= threshold;
    case 'eq':
      return value === threshold;
    default:
      return false;
  }
}

/** Clear side of hysteresis band (must fully exit before re-open). */
export function isCleared(
  value: number,
  operator: Operator,
  threshold: number,
  hysteresis: number,
): boolean {
  const h = Math.abs(hysteresis);
  switch (operator) {
    case 'gt':
      return value <= threshold - h;
    case 'gte':
      return value < threshold - h;
    case 'lt':
      return value >= threshold + h;
    case 'lte':
      return value > threshold + h;
    case 'eq':
      return value !== threshold;
    default:
      return true;
  }
}

export async function createRule(
  tenantId: string,
  actorId: string,
  input: {
    entityType: string;
    metric: string;
    operator: Operator;
    threshold: number;
    action?: string;
    hysteresis?: number;
  },
): Promise<AlertRule> {
  return runCrudOperation({
    configName: 'threshold-alert',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      if (!input.entityType || !input.metric) {
        throw new AppError('entityType and metric required', ErrorCode.BAD_REQUEST);
      }
      if (!Operators.includes(input.operator)) {
        throw new AppError('invalid operator', ErrorCode.BAD_REQUEST);
      }
      if (typeof input.threshold !== 'number') {
        throw new AppError('threshold required', ErrorCode.BAD_REQUEST);
      }
      const rule: AlertRule = {
        id: crypto.randomUUID(),
        tenantId,
        entityType: input.entityType,
        metric: input.metric,
        operator: input.operator,
        threshold: input.threshold,
        hysteresis:
          input.hysteresis !== undefined
            ? input.hysteresis
            : config.defaultHysteresis,
        action: input.action || 'notify',
        active: true,
        createdAt: new Date().toISOString(),
      };
      rules.set(rule.id, rule);
      return rule;
    },
    auditAction: 'data.created',
    auditResource: 'alert_rule',
    meterEventType: 'api_call',
  });
}

export async function evaluate(
  tenantId: string,
  actorId: string,
  input: {
    entityType: string;
    entityId: string;
    metric: string;
    value: number;
  },
): Promise<{ fired: AlertEvent[]; resolved: AlertEvent[] }> {
  return runCrudOperation({
    configName: 'threshold-alert',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (typeof input.value !== 'number' || Number.isNaN(input.value)) {
        throw new AppError('value must be a number', ErrorCode.BAD_REQUEST);
      }
      const matching = [...rules.values()].filter(
        (r) =>
          r.tenantId === tenantId &&
          r.active &&
          r.entityType === input.entityType &&
          r.metric === input.metric,
      );

      const fired: AlertEvent[] = [];
      const resolved: AlertEvent[] = [];

      for (const rule of matching) {
        const open = [...events.values()].find(
          (e) =>
            e.tenantId === tenantId &&
            e.ruleId === rule.id &&
            e.entityId === input.entityId &&
            e.status === 'open',
        );

        if (
          crossesThreshold(input.value, rule.operator, rule.threshold) &&
          !open
        ) {
          const ev: AlertEvent = {
            id: crypto.randomUUID(),
            tenantId,
            ruleId: rule.id,
            entityId: input.entityId,
            metric: rule.metric,
            value: input.value,
            triggeredAt: new Date().toISOString(),
            resolvedAt: null,
            status: 'open',
            actionFired: rule.action,
          };
          events.set(ev.id, ev);
          fired.push(ev);
          logger.info(
            { ruleId: rule.id, entityId: input.entityId, value: input.value },
            'Alert fired',
          );
        } else if (
          open &&
          isCleared(input.value, rule.operator, rule.threshold, rule.hysteresis)
        ) {
          open.status = 'resolved';
          open.resolvedAt = new Date().toISOString();
          events.set(open.id, open);
          resolved.push(open);
          logger.info(
            { ruleId: rule.id, entityId: input.entityId },
            'Alert resolved',
          );
        }
      }
      return { fired, resolved };
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'alert_event',
    meterEventType: 'api_call',
  });
}

export async function listOpen(
  tenantId: string,
  entityId?: string,
): Promise<AlertEvent[]> {
  return [...events.values()].filter(
    (e) =>
      e.tenantId === tenantId &&
      e.status === 'open' &&
      (!entityId || e.entityId === entityId),
  );
}

export async function getRule(ruleId: string): Promise<AlertRule | null> {
  return rules.get(ruleId) || null;
}

export async function deactivateRule(
  tenantId: string,
  actorId: string,
  ruleId: string,
): Promise<AlertRule> {
  return runCrudOperation({
    configName: 'threshold-alert',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const rule = rules.get(ruleId);
      if (!rule || rule.tenantId !== tenantId) {
        throw new AppError('Rule not found', ErrorCode.NOT_FOUND);
      }
      rule.active = false;
      rules.set(ruleId, rule);
      return rule;
    },
    auditAction: 'data.updated',
    auditResource: 'alert_rule',
    meterEventType: 'api_call',
  });
}
