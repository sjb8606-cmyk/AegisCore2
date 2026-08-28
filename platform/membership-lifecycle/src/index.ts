/**
 * platform/membership-lifecycle (FIT-01)
 *
 * Membership activate / freeze / cancel + entitlement checks.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('membership-lifecycle');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  maxFreezeDays: z.number().int().positive().default(90),
  allowAccessWhileFrozen: z.boolean().default(false),
});

export type MembershipStatus = 'active' | 'frozen' | 'cancelled' | 'expired';

export interface FreezePeriod {
  start: string;
  end: string | null;
  reason: string | null;
}

export interface Membership {
  id: string;
  tenantId: string;
  memberId: string;
  planId: string;
  status: MembershipStatus;
  startAt: string;
  endAt: string | null;
  cancelAt: string | null;
  freezePeriods: FreezePeriod[];
  createdAt: string;
}

const memberships = new Map<string, Membership>();

export function __resetMembershipLifecycleStore(): void {
  memberships.clear();
}

function getMembershipRecord(tenantId: string, membershipId: string): Membership {
  const m = memberships.get(membershipId);
  if (!m || m.tenantId !== tenantId) {
    throw new AppError('Membership not found', ErrorCode.NOT_FOUND);
  }
  return m;
}

function currentlyFrozen(m: Membership, now = Date.now()): boolean {
  return m.freezePeriods.some((f) => {
    const start = Date.parse(f.start);
    const end = f.end ? Date.parse(f.end) : Number.POSITIVE_INFINITY;
    return start <= now && now < end;
  });
}

export async function activateMembership(
  tenantId: string,
  actorId: string,
  input: {
    memberId: string;
    planId: string;
    startAt?: string;
    endAt?: string;
  },
): Promise<Membership> {
  return runCrudOperation({
    configName: 'membership-lifecycle',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!input.memberId?.trim() || !input.planId?.trim()) {
        throw new AppError('memberId and planId required', ErrorCode.BAD_REQUEST);
      }
      const start = input.startAt
        ? Date.parse(input.startAt)
        : Date.now();
      if (Number.isNaN(start)) {
        throw new AppError('invalid startAt', ErrorCode.BAD_REQUEST);
      }
      let endAt: string | null = null;
      if (input.endAt) {
        const end = Date.parse(input.endAt);
        if (Number.isNaN(end) || end <= start) {
          throw new AppError('invalid endAt', ErrorCode.BAD_REQUEST);
        }
        endAt = new Date(end).toISOString();
      }
      const existing = [...memberships.values()].find(
        (m) =>
          m.tenantId === tenantId &&
          m.memberId === input.memberId &&
          (m.status === 'active' || m.status === 'frozen'),
      );
      if (existing) {
        throw new AppError(
          'Member already has an active or frozen membership',
          ErrorCode.CONFLICT,
        );
      }
      const m: Membership = {
        id: crypto.randomUUID(),
        tenantId,
        memberId: input.memberId,
        planId: input.planId,
        status: 'active',
        startAt: new Date(start).toISOString(),
        endAt,
        cancelAt: null,
        freezePeriods: [],
        createdAt: new Date().toISOString(),
      };
      memberships.set(m.id, m);
      return m;
    },
    auditAction: 'data.created',
    auditResource: 'fit_membership',
    meterEventType: 'api_call',
  });
}

export async function freezeMembership(
  tenantId: string,
  actorId: string,
  membershipId: string,
  input?: { reason?: string; freezeStart?: string },
): Promise<Membership> {
  return runCrudOperation({
    configName: 'membership-lifecycle',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const m = getMembershipRecord(tenantId, membershipId);
      if (m.status !== 'active') {
        throw new AppError('Only active memberships can freeze', ErrorCode.CONFLICT);
      }
      const start = input?.freezeStart
        ? Date.parse(input.freezeStart)
        : Date.now();
      if (Number.isNaN(start)) {
        throw new AppError('invalid freezeStart', ErrorCode.BAD_REQUEST);
      }
      m.status = 'frozen';
      m.freezePeriods.push({
        start: new Date(start).toISOString(),
        end: null,
        reason: input?.reason?.trim() || null,
      });
      memberships.set(membershipId, m);
      logger.info({ membershipId }, 'Membership frozen');
      return m;
    },
    auditAction: 'data.updated',
    auditResource: 'fit_membership',
    meterEventType: 'api_call',
  });
}

export async function unfreezeMembership(
  tenantId: string,
  actorId: string,
  membershipId: string,
): Promise<Membership> {
  return runCrudOperation({
    configName: 'membership-lifecycle',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const m = getMembershipRecord(tenantId, membershipId);
      if (m.status !== 'frozen') {
        throw new AppError('Membership is not frozen', ErrorCode.CONFLICT);
      }
      const open = m.freezePeriods.find((f) => f.end === null);
      if (open) open.end = new Date().toISOString();
      m.status = 'active';
      memberships.set(membershipId, m);
      return m;
    },
    auditAction: 'data.updated',
    auditResource: 'fit_membership',
    meterEventType: 'api_call',
  });
}

export async function cancelMembership(
  tenantId: string,
  actorId: string,
  membershipId: string,
  cancelAt?: string,
): Promise<Membership> {
  return runCrudOperation({
    configName: 'membership-lifecycle',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const m = getMembershipRecord(tenantId, membershipId);
      if (m.status === 'cancelled') {
        throw new AppError('Already cancelled', ErrorCode.CONFLICT);
      }
      const at = cancelAt ? Date.parse(cancelAt) : Date.now();
      if (Number.isNaN(at)) {
        throw new AppError('invalid cancelAt', ErrorCode.BAD_REQUEST);
      }
      m.status = 'cancelled';
      m.cancelAt = new Date(at).toISOString();
      const open = m.freezePeriods.find((f) => f.end === null);
      if (open) open.end = m.cancelAt;
      memberships.set(membershipId, m);
      return m;
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'fit_membership',
    meterEventType: 'api_call',
  });
}

export async function assertEntitled(
  tenantId: string,
  memberId: string,
): Promise<{ entitled: boolean; membershipId: string | null; status: MembershipStatus | null }> {
  const { loadConfig } = await import('@platform/utils');
  const config = loadConfig('membership-lifecycle', ConfigSchema);
  const now = Date.now();
  const candidates = [...memberships.values()].filter(
    (m) => m.tenantId === tenantId && m.memberId === memberId,
  );
  for (const m of candidates) {
    if (m.endAt && Date.parse(m.endAt) < now) {
      if (m.status !== 'expired' && m.status !== 'cancelled') {
        m.status = 'expired';
        memberships.set(m.id, m);
      }
      continue;
    }
    if (m.status === 'active') {
      return { entitled: true, membershipId: m.id, status: 'active' };
    }
    if (m.status === 'frozen') {
      if (config.allowAccessWhileFrozen || !currentlyFrozen(m, now)) {
        return {
          entitled: config.allowAccessWhileFrozen,
          membershipId: m.id,
          status: 'frozen',
        };
      }
      throw new AppError('Membership frozen', ErrorCode.FORBIDDEN);
    }
  }
  throw new AppError('No active membership', ErrorCode.FORBIDDEN);
}

export async function getMembership(
  tenantId: string,
  actorId: string,
  membershipId: string,
): Promise<Membership> {
  return runCrudOperation({
    configName: 'membership-lifecycle',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => getMembershipRecord(tenantId, membershipId),
    auditAction: 'data.read',
    auditResource: 'fit_membership',
    meterEventType: 'api_call',
  });
}
