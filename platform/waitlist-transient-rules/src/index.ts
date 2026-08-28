/**
 * platform/waitlist-transient-rules (MAR-02)
 *
 * Seasonal vs transient berth demand, waitlist queue, deposit hold, promote.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('waitlist-transient-rules');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  defaultDepositCents: z.number().int().nonnegative().default(50000),
  offerTtlHours: z.number().positive().default(48),
  seasonalPriorityBoost: z.number().int().default(10),
});

export type BerthRequestType = 'seasonal' | 'transient';
export type WaitlistStatus =
  | 'queued'
  | 'offered'
  | 'accepted'
  | 'declined'
  | 'expired'
  | 'cancelled';

export interface BerthWaitlistEntry {
  id: string;
  tenantId: string;
  vesselId: string;
  requestType: BerthRequestType;
  preferredSlipId: string | null;
  depositCents: number;
  depositHeld: boolean;
  status: WaitlistStatus;
  position: number;
  offeredAt: string | null;
  offerExpiresAt: string | null;
  createdAt: string;
}

const entries = new Map<string, BerthWaitlistEntry>();

export function __resetWaitlistTransientStore(): void {
  entries.clear();
}

function activeQueue(tenantId: string): BerthWaitlistEntry[] {
  return [...entries.values()]
    .filter(
      (e) =>
        e.tenantId === tenantId &&
        (e.status === 'queued' || e.status === 'offered'),
    )
    .sort((a, b) => {
      // seasonal first by boost, then FIFO position
      const score = (e: BerthWaitlistEntry) =>
        (e.requestType === 'seasonal' ? 1000 : 0) - e.position;
      return score(b) - score(a) || a.position - b.position;
    });
}

function reindex(tenantId: string): void {
  const queued = [...entries.values()]
    .filter((e) => e.tenantId === tenantId && e.status === 'queued')
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  queued.forEach((e, i) => {
    e.position = i + 1;
    entries.set(e.id, e);
  });
}

export async function joinWaitlist(
  tenantId: string,
  actorId: string,
  input: {
    vesselId: string;
    requestType: BerthRequestType;
    preferredSlipId?: string;
    depositCents?: number;
    holdDeposit?: boolean;
  },
): Promise<BerthWaitlistEntry> {
  return runCrudOperation({
    configName: 'waitlist-transient-rules',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('waitlist-transient-rules', ConfigSchema);
      if (!input.vesselId?.trim()) {
        throw new AppError('vesselId required', ErrorCode.BAD_REQUEST);
      }
      if (input.requestType !== 'seasonal' && input.requestType !== 'transient') {
        throw new AppError('invalid requestType', ErrorCode.BAD_REQUEST);
      }
      const existing = [...entries.values()].find(
        (e) =>
          e.tenantId === tenantId &&
          e.vesselId === input.vesselId &&
          (e.status === 'queued' || e.status === 'offered'),
      );
      if (existing) {
        throw new AppError('Vessel already on waitlist', ErrorCode.CONFLICT);
      }
      const depositCents = input.depositCents ?? config.defaultDepositCents;
      const position =
        [...entries.values()].filter(
          (e) => e.tenantId === tenantId && e.status === 'queued',
        ).length + 1;
      const row: BerthWaitlistEntry = {
        id: crypto.randomUUID(),
        tenantId,
        vesselId: input.vesselId,
        requestType: input.requestType,
        preferredSlipId: input.preferredSlipId || null,
        depositCents,
        depositHeld: input.holdDeposit !== false && depositCents > 0,
        status: 'queued',
        position,
        offeredAt: null,
        offerExpiresAt: null,
        createdAt: new Date().toISOString(),
      };
      entries.set(row.id, row);
      reindex(tenantId);
      return entries.get(row.id)!;
    },
    auditAction: 'data.created',
    auditResource: 'marina_waitlist',
    meterEventType: 'api_call',
  });
}

export async function offerNextBerth(
  tenantId: string,
  actorId: string,
  slipId?: string,
): Promise<BerthWaitlistEntry | null> {
  return runCrudOperation({
    configName: 'waitlist-transient-rules',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('waitlist-transient-rules', ConfigSchema);
      // expire stale offers first
      const now = Date.now();
      for (const [id, e] of entries) {
        if (
          e.tenantId === tenantId &&
          e.status === 'offered' &&
          e.offerExpiresAt &&
          Date.parse(e.offerExpiresAt) <= now
        ) {
          e.status = 'expired';
          entries.set(id, e);
        }
      }
      const next = activeQueue(tenantId).find((e) => e.status === 'queued');
      if (!next) return null;
      next.status = 'offered';
      next.offeredAt = new Date().toISOString();
      next.offerExpiresAt = new Date(
        now + config.offerTtlHours * 3_600_000,
      ).toISOString();
      if (slipId) next.preferredSlipId = slipId;
      entries.set(next.id, next);
      logger.info({ entryId: next.id, vesselId: next.vesselId }, 'Berth offered');
      return next;
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'marina_waitlist',
    meterEventType: 'api_call',
  });
}

export async function acceptOffer(
  tenantId: string,
  actorId: string,
  entryId: string,
): Promise<BerthWaitlistEntry> {
  return runCrudOperation({
    configName: 'waitlist-transient-rules',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const e = entries.get(entryId);
      if (!e || e.tenantId !== tenantId) {
        throw new AppError('Waitlist entry not found', ErrorCode.NOT_FOUND);
      }
      if (e.status !== 'offered') {
        throw new AppError('Entry not in offered state', ErrorCode.CONFLICT);
      }
      if (e.offerExpiresAt && Date.parse(e.offerExpiresAt) < Date.now()) {
        e.status = 'expired';
        entries.set(entryId, e);
        throw new AppError('Offer expired', ErrorCode.CONFLICT);
      }
      e.status = 'accepted';
      entries.set(entryId, e);
      reindex(tenantId);
      return e;
    },
    auditAction: 'data.updated',
    auditResource: 'marina_waitlist',
    meterEventType: 'api_call',
  });
}

export async function declineOffer(
  tenantId: string,
  actorId: string,
  entryId: string,
): Promise<BerthWaitlistEntry> {
  return runCrudOperation({
    configName: 'waitlist-transient-rules',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const e = entries.get(entryId);
      if (!e || e.tenantId !== tenantId) {
        throw new AppError('Waitlist entry not found', ErrorCode.NOT_FOUND);
      }
      if (e.status !== 'offered' && e.status !== 'queued') {
        throw new AppError('Cannot decline from current state', ErrorCode.CONFLICT);
      }
      e.status = e.status === 'offered' ? 'declined' : 'cancelled';
      e.depositHeld = false;
      entries.set(entryId, e);
      reindex(tenantId);
      return e;
    },
    auditAction: 'data.updated',
    auditResource: 'marina_waitlist',
    meterEventType: 'api_call',
  });
}

export async function getWaitlist(
  tenantId: string,
  actorId: string,
): Promise<BerthWaitlistEntry[]> {
  return runCrudOperation({
    configName: 'waitlist-transient-rules',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => activeQueue(tenantId),
    auditAction: 'data.read',
    auditResource: 'marina_waitlist',
    meterEventType: 'api_call',
  });
}
