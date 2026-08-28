/**
 * platform/overbooking-policy (HOSP-03)
 *
 * Capacity vs confirmed bookings, overbook allowance, walk/upgrade/comp codes.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('overbooking-policy');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  overbookPercentBps: z.number().int().min(0).max(5000).default(500),
  defaultCompensationCents: z.number().int().nonnegative().default(10000),
  walkReasonCodes: z
    .array(z.string())
    .default(['overbook', 'maintenance', 'vip_hold', 'other']),
});

export interface RoomTypeCapacity {
  tenantId: string;
  roomTypeId: string;
  date: string; // YYYY-MM-DD
  physicalRooms: number;
  confirmed: number;
}

export interface WalkEvent {
  id: string;
  tenantId: string;
  reservationId: string;
  roomTypeId: string;
  date: string;
  reasonCode: string;
  compensationCents: number;
  upgradeToRoomTypeId: string | null;
  notes: string | null;
  createdAt: string;
  actorId: string;
}

const capacity = new Map<string, RoomTypeCapacity>();
const walks = new Map<string, WalkEvent>();

export function __resetOverbookingPolicyStore(): void {
  capacity.clear();
  walks.clear();
}

function capKey(tenantId: string, roomTypeId: string, date: string): string {
  return tenantId + ':' + roomTypeId + ':' + date;
}

function maxSellable(physical: number, overbookBps: number): number {
  return physical + Math.floor((physical * overbookBps) / 10000);
}

export async function setCapacity(
  tenantId: string,
  actorId: string,
  input: {
    roomTypeId: string;
    date: string;
    physicalRooms: number;
    confirmed?: number;
  },
): Promise<RoomTypeCapacity> {
  return runCrudOperation({
    configName: 'overbooking-policy',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!input.roomTypeId?.trim() || !input.date?.trim()) {
        throw new AppError('roomTypeId and date required', ErrorCode.BAD_REQUEST);
      }
      if (!Number.isInteger(input.physicalRooms) || input.physicalRooms < 0) {
        throw new AppError('physicalRooms must be >= 0', ErrorCode.BAD_REQUEST);
      }
      const key = capKey(tenantId, input.roomTypeId, input.date);
      const existing = capacity.get(key);
      const row: RoomTypeCapacity = {
        tenantId,
        roomTypeId: input.roomTypeId,
        date: input.date,
        physicalRooms: input.physicalRooms,
        confirmed: input.confirmed ?? existing?.confirmed ?? 0,
      };
      capacity.set(key, row);
      return row;
    },
    auditAction: 'data.updated',
    auditResource: 'hosp_room_capacity',
    meterEventType: 'api_call',
  });
}

export async function tryConfirmBooking(
  tenantId: string,
  actorId: string,
  input: { roomTypeId: string; date: string },
): Promise<{ confirmed: boolean; capacity: RoomTypeCapacity; maxSellable: number }> {
  return runCrudOperation({
    configName: 'overbooking-policy',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('overbooking-policy', ConfigSchema);
      const key = capKey(tenantId, input.roomTypeId, input.date);
      const row = capacity.get(key);
      if (!row) {
        throw new AppError('Capacity not configured for date/type', ErrorCode.NOT_FOUND);
      }
      const max = maxSellable(row.physicalRooms, config.overbookPercentBps);
      if (row.confirmed >= max) {
        return { confirmed: false, capacity: row, maxSellable: max };
      }
      row.confirmed += 1;
      capacity.set(key, row);
      return { confirmed: true, capacity: row, maxSellable: max };
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'hosp_room_capacity',
    meterEventType: 'api_call',
  });
}

export async function releaseBooking(
  tenantId: string,
  actorId: string,
  input: { roomTypeId: string; date: string },
): Promise<RoomTypeCapacity> {
  return runCrudOperation({
    configName: 'overbooking-policy',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const key = capKey(tenantId, input.roomTypeId, input.date);
      const row = capacity.get(key);
      if (!row) {
        throw new AppError('Capacity not found', ErrorCode.NOT_FOUND);
      }
      row.confirmed = Math.max(0, row.confirmed - 1);
      capacity.set(key, row);
      return row;
    },
    auditAction: 'data.updated',
    auditResource: 'hosp_room_capacity',
    meterEventType: 'api_call',
  });
}

export async function recordWalk(
  tenantId: string,
  actorId: string,
  input: {
    reservationId: string;
    roomTypeId: string;
    date: string;
    reasonCode: string;
    compensationCents?: number;
    upgradeToRoomTypeId?: string;
    notes?: string;
  },
): Promise<WalkEvent> {
  return runCrudOperation({
    configName: 'overbooking-policy',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('overbooking-policy', ConfigSchema);
      if (!input.reservationId?.trim()) {
        throw new AppError('reservationId required', ErrorCode.BAD_REQUEST);
      }
      const reason = input.reasonCode?.trim().toLowerCase();
      if (
        !reason ||
        !config.walkReasonCodes.map((r) => r.toLowerCase()).includes(reason)
      ) {
        throw new AppError('invalid reasonCode', ErrorCode.BAD_REQUEST);
      }
      const event: WalkEvent = {
        id: crypto.randomUUID(),
        tenantId,
        reservationId: input.reservationId,
        roomTypeId: input.roomTypeId,
        date: input.date,
        reasonCode: reason,
        compensationCents:
          input.compensationCents ?? config.defaultCompensationCents,
        upgradeToRoomTypeId: input.upgradeToRoomTypeId || null,
        notes: input.notes?.trim() || null,
        createdAt: new Date().toISOString(),
        actorId,
      };
      walks.set(event.id, event);
      // free the confirmed slot for the walked type
      const key = capKey(tenantId, input.roomTypeId, input.date);
      const row = capacity.get(key);
      if (row) {
        row.confirmed = Math.max(0, row.confirmed - 1);
        capacity.set(key, row);
      }
      logger.warn(
        { reservationId: input.reservationId, reason },
        'Guest walked',
      );
      return event;
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'hosp_walk_event',
    meterEventType: 'api_call',
  });
}

export async function getAvailability(
  tenantId: string,
  actorId: string,
  roomTypeId: string,
  date: string,
): Promise<{
  physicalRooms: number;
  confirmed: number;
  maxSellable: number;
  remaining: number;
}> {
  return runCrudOperation({
    configName: 'overbooking-policy',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('overbooking-policy', ConfigSchema);
      const row = capacity.get(capKey(tenantId, roomTypeId, date));
      if (!row) {
        throw new AppError('Capacity not found', ErrorCode.NOT_FOUND);
      }
      const max = maxSellable(row.physicalRooms, config.overbookPercentBps);
      return {
        physicalRooms: row.physicalRooms,
        confirmed: row.confirmed,
        maxSellable: max,
        remaining: Math.max(0, max - row.confirmed),
      };
    },
    auditAction: 'data.read',
    auditResource: 'hosp_room_capacity',
    meterEventType: 'api_call',
  });
}
