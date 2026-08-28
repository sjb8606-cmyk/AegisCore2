/**
 * platform/access-control-events (FIT-03)
 *
 * Door/turnstile check-in events vs membership entitlement.
 * Entitlement is injectable (FIT-01 assertEntitled or equivalent).
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('access-control-events');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  requireEntitlement: z.boolean().default(true),
  locations: z.array(z.string()).default(['main_door', 'gym_floor', 'studio']),
});

export type AccessResult = 'granted' | 'denied';

export interface AccessEvent {
  id: string;
  tenantId: string;
  memberId: string;
  location: string;
  result: AccessResult;
  reason: string | null;
  deviceId: string | null;
  createdAt: string;
}

type EntitlementFn = (
  tenantId: string,
  memberId: string,
) => Promise<{ entitled: boolean; reason?: string }>;

const events = new Map<string, AccessEvent>();
let entitlementFn: EntitlementFn = async () => ({ entitled: true });

export function __resetAccessControlStore(): void {
  events.clear();
  entitlementFn = async () => ({ entitled: true });
}

export function setEntitlementFn(fn: EntitlementFn): void {
  entitlementFn = fn;
}

export async function attemptAccess(
  tenantId: string,
  actorId: string,
  input: {
    memberId: string;
    location: string;
    deviceId?: string;
  },
): Promise<AccessEvent> {
  return runCrudOperation({
    configName: 'access-control-events',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('access-control-events', ConfigSchema);
      if (!input.memberId?.trim()) {
        throw new AppError('memberId required', ErrorCode.BAD_REQUEST);
      }
      if (!input.location?.trim()) {
        throw new AppError('location required', ErrorCode.BAD_REQUEST);
      }
      if (
        config.locations.length > 0 &&
        !config.locations.includes(input.location)
      ) {
        throw new AppError('unknown location', ErrorCode.BAD_REQUEST);
      }

      let result: AccessResult = 'granted';
      let reason: string | null = null;

      if (config.requireEntitlement) {
        const ent = await entitlementFn(tenantId, input.memberId);
        if (!ent.entitled) {
          result = 'denied';
          reason = ent.reason || 'Not entitled';
        }
      }

      const event: AccessEvent = {
        id: crypto.randomUUID(),
        tenantId,
        memberId: input.memberId,
        location: input.location,
        result,
        reason,
        deviceId: input.deviceId || null,
        createdAt: new Date().toISOString(),
      };
      events.set(event.id, event);
      if (result === 'denied') {
        logger.warn(
          { memberId: input.memberId, location: input.location, reason },
          'Access denied',
        );
      }
      return event;
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'fit_access_event',
    meterEventType: 'api_call',
  });
}

export async function listAccessEvents(
  tenantId: string,
  actorId: string,
  filter?: { memberId?: string; result?: AccessResult; since?: string },
): Promise<AccessEvent[]> {
  return runCrudOperation({
    configName: 'access-control-events',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      let rows = [...events.values()].filter((e) => e.tenantId === tenantId);
      if (filter?.memberId) {
        rows = rows.filter((e) => e.memberId === filter.memberId);
      }
      if (filter?.result) {
        rows = rows.filter((e) => e.result === filter.result);
      }
      if (filter?.since) {
        const since = Date.parse(filter.since);
        if (Number.isNaN(since)) {
          throw new AppError('invalid since', ErrorCode.BAD_REQUEST);
        }
        rows = rows.filter((e) => Date.parse(e.createdAt) >= since);
      }
      return rows.sort(
        (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
      );
    },
    auditAction: 'data.read',
    auditResource: 'fit_access_event',
    meterEventType: 'api_call',
  });
}

export async function getDenialCount(
  tenantId: string,
  actorId: string,
  memberId: string,
  sinceIso: string,
): Promise<{ memberId: string; denials: number }> {
  return runCrudOperation({
    configName: 'access-control-events',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const since = Date.parse(sinceIso);
      if (Number.isNaN(since)) {
        throw new AppError('invalid since', ErrorCode.BAD_REQUEST);
      }
      const denials = [...events.values()].filter(
        (e) =>
          e.tenantId === tenantId &&
          e.memberId === memberId &&
          e.result === 'denied' &&
          Date.parse(e.createdAt) >= since,
      ).length;
      return { memberId, denials };
    },
    auditAction: 'data.read',
    auditResource: 'fit_access_event',
    meterEventType: 'api_call',
  });
}
