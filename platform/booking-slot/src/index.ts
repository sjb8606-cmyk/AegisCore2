/**
 * platform/booking-slot
 *
 * Calendar slots: available → booked; cancel within configured window.
 * Distinct from job queues — this is appointment/reservation shaped.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('booking-slot');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  serviceTypes: z
    .array(
      z.object({
        type: z.string(),
        defaultDurationMinutes: z.number().int().positive().default(30),
      }),
    )
    .default([{ type: 'consultation', defaultDurationMinutes: 30 }]),
  cancellationWindowMinutes: z.number().int().nonnegative().default(60),
});

export type SlotStatus = 'available' | 'booked' | 'cancelled';

export interface Slot {
  id: string;
  tenantId: string;
  serviceType: string;
  startTime: string;
  durationMinutes: number;
  status: SlotStatus;
  bookedBy: string | null;
  bookedAt: string | null;
  createdAt: string;
}

const slots = new Map<string, Slot>();

export function __resetBookingSlotStore(): void {
  slots.clear();
}

async function loadCfg() {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('booking-slot', ConfigSchema);
}

function overlaps(
  aStart: number,
  aDur: number,
  bStart: number,
  bDur: number,
): boolean {
  const aEnd = aStart + aDur * 60_000;
  const bEnd = bStart + bDur * 60_000;
  return aStart < bEnd && bStart < aEnd;
}

export async function createSlot(
  tenantId: string,
  actorId: string,
  input: {
    serviceType: string;
    startTime: string;
    durationMinutes?: number;
  },
): Promise<Slot> {
  return runCrudOperation({
    configName: 'booking-slot',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      const st = config.serviceTypes.find((s) => s.type === input.serviceType);
      if (!st) {
        throw new AppError(
          'Unknown service type: ' + input.serviceType,
          ErrorCode.BAD_REQUEST,
        );
      }
      const startMs = Date.parse(input.startTime);
      if (Number.isNaN(startMs)) {
        throw new AppError('invalid startTime', ErrorCode.BAD_REQUEST);
      }
      const duration =
        input.durationMinutes ?? st.defaultDurationMinutes;
      if (duration <= 0) {
        throw new AppError('duration must be positive', ErrorCode.BAD_REQUEST);
      }
      // prevent overlapping available/booked slots of same type
      for (const s of slots.values()) {
        if (
          s.tenantId === tenantId &&
          s.serviceType === input.serviceType &&
          s.status !== 'cancelled'
        ) {
          if (
            overlaps(
              startMs,
              duration,
              Date.parse(s.startTime),
              s.durationMinutes,
            )
          ) {
            throw new AppError('Slot overlaps existing', ErrorCode.CONFLICT);
          }
        }
      }
      const slot: Slot = {
        id: crypto.randomUUID(),
        tenantId,
        serviceType: input.serviceType,
        startTime: new Date(startMs).toISOString(),
        durationMinutes: duration,
        status: 'available',
        bookedBy: null,
        bookedAt: null,
        createdAt: new Date().toISOString(),
      };
      slots.set(slot.id, slot);
      return slot;
    },
    auditAction: 'data.created',
    auditResource: 'slot',
    meterEventType: 'api_call',
  });
}

export async function listAvailable(
  tenantId: string,
  filter?: {
    serviceType?: string;
    from?: string;
    to?: string;
  },
): Promise<Slot[]> {
  const fromMs = filter?.from ? Date.parse(filter.from) : 0;
  const toMs = filter?.to ? Date.parse(filter.to) : Number.MAX_SAFE_INTEGER;
  return [...slots.values()]
    .filter((s) => {
      if (s.tenantId !== tenantId || s.status !== 'available') return false;
      if (filter?.serviceType && s.serviceType !== filter.serviceType)
        return false;
      const t = Date.parse(s.startTime);
      return t >= fromMs && t <= toMs;
    })
    .sort(
      (a, b) =>
        Date.parse(a.startTime) - Date.parse(b.startTime),
    );
}

export async function bookSlot(
  tenantId: string,
  actorId: string,
  slotId: string,
  bookedBy: string,
): Promise<Slot> {
  return runCrudOperation({
    configName: 'booking-slot',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const slot = slots.get(slotId);
      if (!slot || slot.tenantId !== tenantId) {
        throw new AppError('Slot not found', ErrorCode.NOT_FOUND);
      }
      if (slot.status !== 'available') {
        throw new AppError('Slot not available', ErrorCode.CONFLICT);
      }
      if (!bookedBy?.trim()) {
        throw new AppError('bookedBy required', ErrorCode.BAD_REQUEST);
      }
      slot.status = 'booked';
      slot.bookedBy = bookedBy.trim();
      slot.bookedAt = new Date().toISOString();
      slots.set(slotId, slot);
      logger.info({ slotId, bookedBy }, 'Slot booked');
      return slot;
    },
    auditAction: 'data.updated',
    auditResource: 'slot',
    meterEventType: 'api_call',
  });
}

export async function cancelSlot(
  tenantId: string,
  actorId: string,
  slotId: string,
  cancelledBy?: string,
): Promise<Slot> {
  return runCrudOperation({
    configName: 'booking-slot',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      const slot = slots.get(slotId);
      if (!slot || slot.tenantId !== tenantId) {
        throw new AppError('Slot not found', ErrorCode.NOT_FOUND);
      }
      if (slot.status === 'cancelled') {
        throw new AppError('Already cancelled', ErrorCode.CONFLICT);
      }
      if (slot.status === 'booked') {
        const startMs = Date.parse(slot.startTime);
        const windowMs = config.cancellationWindowMinutes * 60_000;
        if (Date.now() > startMs - windowMs) {
          throw new AppError(
            'Inside cancellation window',
            ErrorCode.FORBIDDEN,
          );
        }
        if (
          cancelledBy &&
          slot.bookedBy &&
          cancelledBy !== slot.bookedBy &&
          cancelledBy !== actorId
        ) {
          // soft check — apps can tighten via rbac
        }
      }
      slot.status = 'cancelled';
      slots.set(slotId, slot);
      return slot;
    },
    auditAction: 'data.updated',
    auditResource: 'slot',
    meterEventType: 'api_call',
  });
}

export async function getSlot(
  tenantId: string,
  slotId: string,
): Promise<Slot | null> {
  const s = slots.get(slotId);
  if (!s || s.tenantId !== tenantId) return null;
  return s;
}
