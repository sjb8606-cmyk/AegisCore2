/**
 * platform/planner-matching
 *
 * Deterministic actor↔entity matching + shift confirmation.
 * On confirm: creates shift and optionally a liability contract (A2).
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { createContract, signContract } from '@platform/liability-contracts';
import { listActors, type PlannerActor } from '@platform/planner-actors';
import { getEntity, updateEntity } from '@platform/planner-entities';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('planner-matching');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  matchStrategy: z
    .enum(['first-available', 'reliability-weighted', 'proximity-weighted'])
    .default('reliability-weighted'),
  slotDurationMinutes: z.number().int().positive().default(60),
  autoCreateContract: z.boolean().default(true),
  contractNiche: z.string().default('planner-shift'),
});

export type PlannerMatchingConfig = z.infer<typeof ConfigSchema>;

export type ShiftStatus =
  | 'proposed'
  | 'confirmed'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

export interface MatchCandidate {
  actor: PlannerActor;
  score: number;
  reasons: string[];
}

export interface PlannerShift {
  id: string;
  tenantId: string;
  niche: string;
  actorId: string;
  entityId: string;
  startTime: string;
  endTime: string;
  status: ShiftStatus;
  contractId: string | null;
  createdAt: string;
}

const shifts = new Map<string, PlannerShift>();

export function __resetPlannerMatchingStore(): void {
  shifts.clear();
}

async function loadCfg(): Promise<PlannerMatchingConfig> {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('planner-matching', ConfigSchema);
}

function overlaps(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function actorAvailableInWindow(
  actor: PlannerActor,
  windowStart: Date,
  windowEnd: Date,
): boolean {
  if (!actor.availability.length) return true; // open calendar = available
  const day = windowStart.getUTCDay();
  const startHour = windowStart.getUTCHours() + windowStart.getUTCMinutes() / 60;
  const endHour = windowEnd.getUTCHours() + windowEnd.getUTCMinutes() / 60;
  return actor.availability.some(
    (w) =>
      w.dayOfWeek === day &&
      overlaps(startHour, endHour, w.startHour, w.endHour),
  );
}

function scoreActor(
  actor: PlannerActor,
  strategy: string,
  entityTags: string[],
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  if (strategy === 'first-available') {
    score = 1;
    reasons.push('first-available');
  } else if (strategy === 'reliability-weighted') {
    score = actor.reliabilityScore;
    reasons.push(`reliability=${actor.reliabilityScore}`);
  } else {
    // proximity-weighted: no geo yet — fall back to reliability
    score = actor.reliabilityScore * 0.8 + 0.1;
    reasons.push('proximity-fallback-reliability');
  }

  const tagHits = entityTags.filter((t) => actor.tags.includes(t));
  if (tagHits.length) {
    score += 0.05 * tagHits.length;
    reasons.push(`tag-match:${tagHits.join(',')}`);
  }

  return { score, reasons };
}

export async function findMatches(
  tenantId: string,
  actorId: string,
  input: {
    entityId: string;
    windowStart: string;
    windowEnd: string;
    niche?: string;
    csrPartnerId?: string;
    limit?: number;
  },
): Promise<MatchCandidate[]> {
  return runCrudOperation({
    configName: 'planner-matching',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      const entity = await getEntity(tenantId, input.entityId);
      if (!entity) throw new AppError('Entity not found', ErrorCode.NOT_FOUND);

      const start = new Date(input.windowStart);
      const end = new Date(input.windowEnd);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
        throw new AppError('Invalid windowStart/windowEnd', ErrorCode.BAD_REQUEST);
      }

      const candidates = await listActors(tenantId, {
        niche: input.niche || entity.niche,
        activeOnly: true,
        excludeSuspended: true,
        csrPartnerId: input.csrPartnerId,
      });

      const scored: MatchCandidate[] = [];
      for (const actor of candidates) {
        if (!actorAvailableInWindow(actor, start, end)) continue;
        // skip if already booked overlapping
        const busy = [...shifts.values()].some(
          (s) =>
            s.tenantId === tenantId &&
            s.actorId === actor.id &&
            s.status !== 'cancelled' &&
            overlaps(
              start.getTime(),
              end.getTime(),
              new Date(s.startTime).getTime(),
              new Date(s.endTime).getTime(),
            ),
        );
        if (busy) continue;

        const { score, reasons } = scoreActor(
          actor,
          config.matchStrategy,
          entity.tags,
        );
        scored.push({ actor, score, reasons });
      }

      scored.sort((a, b) => b.score - a.score);
      const limit = input.limit && input.limit > 0 ? input.limit : 10;
      return scored.slice(0, limit);
    },
    auditAction: 'data.read',
    auditResource: 'planner_match',
    meterEventType: 'api_call',
  });
}

export async function confirmShift(
  tenantId: string,
  actorId: string,
  input: {
    niche?: string;
    matchActorId: string;
    entityId: string;
    startTime: string;
    endTime?: string;
    autoSignContract?: boolean;
    geoData?: { lat: number; lng: number };
  },
): Promise<{ shift: PlannerShift; contractId: string | null }> {
  return runCrudOperation({
    configName: 'planner-matching',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      const entity = await getEntity(tenantId, input.entityId);
      if (!entity) throw new AppError('Entity not found', ErrorCode.NOT_FOUND);

      const start = new Date(input.startTime);
      if (Number.isNaN(start.getTime())) {
        throw new AppError('Invalid startTime', ErrorCode.BAD_REQUEST);
      }
      const end = input.endTime
        ? new Date(input.endTime)
        : new Date(start.getTime() + config.slotDurationMinutes * 60_000);

      let contractId: string | null = null;
      if (config.autoCreateContract) {
        const contract = await createContract(tenantId, actorId, {
          niche: input.niche || config.contractNiche,
          partyAId: actorId,
          partyBId: input.matchActorId,
          entityId: input.entityId,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
        });
        contractId = contract.id;
        if (input.autoSignContract) {
          await signContract(tenantId, actorId, contract.id, {
            geoData: input.geoData,
          });
        }
      }

      const shift: PlannerShift = {
        id: crypto.randomUUID(),
        tenantId,
        niche: input.niche || entity.niche,
        actorId: input.matchActorId,
        entityId: input.entityId,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        status: 'confirmed',
        contractId,
        createdAt: new Date().toISOString(),
      };
      shifts.set(shift.id, shift);

      await updateEntity(tenantId, actorId, input.entityId, {
        status: 'assigned',
      });

      logger.info(
        { shiftId: shift.id, actorId: input.matchActorId, contractId },
        'Shift confirmed',
      );
      return { shift, contractId };
    },
    auditAction: 'data.created',
    auditResource: 'planner_shift',
    meterEventType: 'api_call',
  });
}

export async function completeShift(
  tenantId: string,
  actorId: string,
  shiftId: string,
): Promise<PlannerShift> {
  return runCrudOperation({
    configName: 'planner-matching',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const shift = shifts.get(shiftId);
      if (!shift || shift.tenantId !== tenantId) {
        throw new AppError('Shift not found', ErrorCode.NOT_FOUND);
      }
      shift.status = 'completed';
      shifts.set(shiftId, shift);
      await updateEntity(tenantId, actorId, shift.entityId, {
        status: 'completed',
      });
      return shift;
    },
    auditAction: 'data.updated',
    auditResource: 'planner_shift',
    meterEventType: 'api_call',
  });
}

export async function getShift(
  tenantId: string,
  shiftId: string,
): Promise<PlannerShift | null> {
  const s = shifts.get(shiftId);
  if (!s || s.tenantId !== tenantId) return null;
  return s;
}

export async function listShifts(
  tenantId: string,
  filter?: { actorId?: string; entityId?: string; status?: ShiftStatus },
): Promise<PlannerShift[]> {
  return [...shifts.values()].filter((s) => {
    if (s.tenantId !== tenantId) return false;
    if (filter?.actorId && s.actorId !== filter.actorId) return false;
    if (filter?.entityId && s.entityId !== filter.entityId) return false;
    if (filter?.status && s.status !== filter.status) return false;
    return true;
  });
}
