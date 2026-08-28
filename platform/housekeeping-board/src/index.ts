/**
 * platform/housekeeping-board (HOSP-01)
 *
 * Room HK status board: dirty → clean → inspect → ready.
 * Assign attendants and prioritize turnovers.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('housekeeping-board');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  requireInspectBeforeReady: z.boolean().default(true),
  priorities: z.array(z.string()).default(['normal', 'rush', 'vip']),
});

export type HkStatus =
  | 'dirty'
  | 'in_progress'
  | 'clean'
  | 'inspect'
  | 'ready'
  | 'ooo';

export interface RoomHkState {
  id: string;
  tenantId: string;
  roomId: string;
  roomLabel: string;
  status: HkStatus;
  attendantId: string | null;
  priority: string;
  notes: string | null;
  updatedAt: string;
}

const rooms = new Map<string, RoomHkState>();

export function __resetHousekeepingBoardStore(): void {
  rooms.clear();
}

function roomKey(tenantId: string, roomId: string): string {
  return tenantId + ':' + roomId;
}

function getRoom(tenantId: string, roomId: string): RoomHkState {
  const r = rooms.get(roomKey(tenantId, roomId));
  if (!r) {
    throw new AppError('Room not on housekeeping board', ErrorCode.NOT_FOUND);
  }
  return r;
}

export async function registerRoom(
  tenantId: string,
  actorId: string,
  input: {
    roomId: string;
    roomLabel: string;
    status?: HkStatus;
    priority?: string;
  },
): Promise<RoomHkState> {
  return runCrudOperation({
    configName: 'housekeeping-board',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!input.roomId?.trim() || !input.roomLabel?.trim()) {
        throw new AppError('roomId and roomLabel required', ErrorCode.BAD_REQUEST);
      }
      const key = roomKey(tenantId, input.roomId);
      if (rooms.has(key)) {
        throw new AppError('Room already registered', ErrorCode.CONFLICT);
      }
      const row: RoomHkState = {
        id: crypto.randomUUID(),
        tenantId,
        roomId: input.roomId,
        roomLabel: input.roomLabel.trim(),
        status: input.status || 'ready',
        attendantId: null,
        priority: input.priority || 'normal',
        notes: null,
        updatedAt: new Date().toISOString(),
      };
      rooms.set(key, row);
      return row;
    },
    auditAction: 'data.created',
    auditResource: 'hosp_hk_room',
    meterEventType: 'api_call',
  });
}

export async function setRoomStatus(
  tenantId: string,
  actorId: string,
  roomId: string,
  status: HkStatus,
  notes?: string,
): Promise<RoomHkState> {
  return runCrudOperation({
    configName: 'housekeeping-board',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('housekeeping-board', ConfigSchema);
      const valid: HkStatus[] = [
        'dirty',
        'in_progress',
        'clean',
        'inspect',
        'ready',
        'ooo',
      ];
      if (!valid.includes(status)) {
        throw new AppError('invalid status', ErrorCode.BAD_REQUEST);
      }
      const room = getRoom(tenantId, roomId);
      if (
        status === 'ready' &&
        config.requireInspectBeforeReady &&
        room.status !== 'inspect' &&
        room.status !== 'ready'
      ) {
        throw new AppError(
          'Room must be inspected before ready',
          ErrorCode.CONFLICT,
        );
      }
      room.status = status;
      if (notes !== undefined) room.notes = notes?.trim() || null;
      room.updatedAt = new Date().toISOString();
      rooms.set(roomKey(tenantId, roomId), room);
      logger.info({ roomId, status }, 'HK status updated');
      return room;
    },
    auditAction: 'data.updated',
    auditResource: 'hosp_hk_room',
    meterEventType: 'api_call',
  });
}

export async function assignAttendant(
  tenantId: string,
  actorId: string,
  roomId: string,
  attendantId: string,
  priority?: string,
): Promise<RoomHkState> {
  return runCrudOperation({
    configName: 'housekeeping-board',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!attendantId?.trim()) {
        throw new AppError('attendantId required', ErrorCode.BAD_REQUEST);
      }
      const room = getRoom(tenantId, roomId);
      room.attendantId = attendantId;
      if (priority) room.priority = priority;
      if (room.status === 'dirty') room.status = 'in_progress';
      room.updatedAt = new Date().toISOString();
      rooms.set(roomKey(tenantId, roomId), room);
      return room;
    },
    auditAction: 'data.updated',
    auditResource: 'hosp_hk_room',
    meterEventType: 'api_call',
  });
}

export async function markCheckoutDirty(
  tenantId: string,
  actorId: string,
  roomId: string,
): Promise<RoomHkState> {
  return setRoomStatus(tenantId, actorId, roomId, 'dirty', 'Checkout turnover');
}

export async function listBoard(
  tenantId: string,
  actorId: string,
  filter?: { status?: HkStatus; attendantId?: string },
): Promise<RoomHkState[]> {
  return runCrudOperation({
    configName: 'housekeeping-board',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      let rows = [...rooms.values()].filter((r) => r.tenantId === tenantId);
      if (filter?.status) rows = rows.filter((r) => r.status === filter.status);
      if (filter?.attendantId) {
        rows = rows.filter((r) => r.attendantId === filter.attendantId);
      }
      const priorityRank: Record<string, number> = {
        vip: 0,
        rush: 1,
        normal: 2,
      };
      return rows.sort((a, b) => {
        const pa = priorityRank[a.priority] ?? 9;
        const pb = priorityRank[b.priority] ?? 9;
        if (pa !== pb) return pa - pb;
        return a.roomLabel.localeCompare(b.roomLabel);
      });
    },
    auditAction: 'data.read',
    auditResource: 'hosp_hk_room',
    meterEventType: 'api_call',
  });
}
