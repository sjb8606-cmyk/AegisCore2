/**
 * platform/resource-conflict-engine (SCH-01)
 *
 * Multi-resource booking: staff + room + equipment.
 * Blocks double-booking on any required resource.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('resource-conflict-engine');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  allowAdjacentTouch: z.boolean().default(true),
});

export type ResourceKind = 'staff' | 'room' | 'equipment' | 'other';

export interface Resource {
  id: string;
  tenantId: string;
  kind: ResourceKind;
  name: string;
  active: boolean;
}

export interface ResourceBooking {
  id: string;
  tenantId: string;
  resourceId: string;
  appointmentId: string;
  startAt: string;
  endAt: string;
  status: 'held' | 'confirmed' | 'released';
}

const resources = new Map<string, Resource>();
const bookings = new Map<string, ResourceBooking>();

export function __resetResourceConflictStore(): void {
  resources.clear();
  bookings.clear();
}

function overlaps(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
  allowAdjacent: boolean,
): boolean {
  if (allowAdjacent) return aStart < bEnd && bStart < aEnd;
  return aStart <= bEnd && bStart <= aEnd;
}

function hasConflict(
  tenantId: string,
  resourceId: string,
  start: number,
  end: number,
  allowAdjacent: boolean,
  excludeAppointmentId?: string,
): boolean {
  for (const b of bookings.values()) {
    if (b.tenantId !== tenantId || b.resourceId !== resourceId) continue;
    if (b.status === 'released') continue;
    if (excludeAppointmentId && b.appointmentId === excludeAppointmentId) continue;
    const s = Date.parse(b.startAt);
    const e = Date.parse(b.endAt);
    if (overlaps(start, end, s, e, allowAdjacent)) return true;
  }
  return false;
}

export async function registerResource(
  tenantId: string,
  actorId: string,
  input: { kind: ResourceKind; name: string },
): Promise<Resource> {
  return runCrudOperation({
    configName: 'resource-conflict-engine',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!input.name?.trim()) {
        throw new AppError('name required', ErrorCode.BAD_REQUEST);
      }
      const kind = input.kind || 'other';
      if (!['staff', 'room', 'equipment', 'other'].includes(kind)) {
        throw new AppError('invalid kind', ErrorCode.BAD_REQUEST);
      }
      const row: Resource = {
        id: crypto.randomUUID(),
        tenantId,
        kind,
        name: input.name.trim(),
        active: true,
      };
      resources.set(row.id, row);
      return row;
    },
    auditAction: 'data.created',
    auditResource: 'sch_resource',
    meterEventType: 'api_call',
  });
}

export async function checkConflicts(
  tenantId: string,
  actorId: string,
  input: {
    resourceIds: string[];
    startAt: string;
    endAt: string;
    excludeAppointmentId?: string;
  },
): Promise<{ ok: boolean; conflicts: string[] }> {
  return runCrudOperation({
    configName: 'resource-conflict-engine',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('resource-conflict-engine', ConfigSchema);
      const start = Date.parse(input.startAt);
      const end = Date.parse(input.endAt);
      if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
        throw new AppError('invalid time range', ErrorCode.BAD_REQUEST);
      }
      if (!input.resourceIds?.length) {
        throw new AppError('resourceIds required', ErrorCode.BAD_REQUEST);
      }
      const conflicts: string[] = [];
      for (const rid of input.resourceIds) {
        const res = resources.get(rid);
        if (!res || res.tenantId !== tenantId || !res.active) {
          conflicts.push(rid + ':not_found');
          continue;
        }
        if (
          hasConflict(
            tenantId,
            rid,
            start,
            end,
            config.allowAdjacentTouch,
            input.excludeAppointmentId,
          )
        ) {
          conflicts.push(rid);
        }
      }
      return { ok: conflicts.length === 0, conflicts };
    },
    auditAction: 'data.read',
    auditResource: 'sch_resource_booking',
    meterEventType: 'api_call',
  });
}

export async function bookResources(
  tenantId: string,
  actorId: string,
  input: {
    appointmentId: string;
    resourceIds: string[];
    startAt: string;
    endAt: string;
  },
): Promise<ResourceBooking[]> {
  return runCrudOperation({
    configName: 'resource-conflict-engine',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('resource-conflict-engine', ConfigSchema);
      if (!input.appointmentId?.trim()) {
        throw new AppError('appointmentId required', ErrorCode.BAD_REQUEST);
      }
      const start = Date.parse(input.startAt);
      const end = Date.parse(input.endAt);
      if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
        throw new AppError('invalid time range', ErrorCode.BAD_REQUEST);
      }
      if (!input.resourceIds?.length) {
        throw new AppError('resourceIds required', ErrorCode.BAD_REQUEST);
      }
      for (const rid of input.resourceIds) {
        const res = resources.get(rid);
        if (!res || res.tenantId !== tenantId || !res.active) {
          throw new AppError('Resource not found: ' + rid, ErrorCode.NOT_FOUND);
        }
        if (
          hasConflict(
            tenantId,
            rid,
            start,
            end,
            config.allowAdjacentTouch,
            input.appointmentId,
          )
        ) {
          throw new AppError(
            'Resource conflict: ' + rid,
            ErrorCode.CONFLICT,
          );
        }
      }
      const created: ResourceBooking[] = [];
      for (const rid of input.resourceIds) {
        const booking: ResourceBooking = {
          id: crypto.randomUUID(),
          tenantId,
          resourceId: rid,
          appointmentId: input.appointmentId,
          startAt: new Date(start).toISOString(),
          endAt: new Date(end).toISOString(),
          status: 'confirmed',
        };
        bookings.set(booking.id, booking);
        created.push(booking);
      }
      logger.info(
        { appointmentId: input.appointmentId, resources: input.resourceIds.length },
        'Resources booked',
      );
      return created;
    },
    auditAction: 'data.created',
    auditResource: 'sch_resource_booking',
    meterEventType: 'api_call',
  });
}

export async function releaseResources(
  tenantId: string,
  actorId: string,
  appointmentId: string,
): Promise<{ released: number }> {
  return runCrudOperation({
    configName: 'resource-conflict-engine',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      let released = 0;
      for (const [id, b] of bookings) {
        if (
          b.tenantId === tenantId &&
          b.appointmentId === appointmentId &&
          b.status !== 'released'
        ) {
          b.status = 'released';
          bookings.set(id, b);
          released += 1;
        }
      }
      return { released };
    },
    auditAction: 'data.updated',
    auditResource: 'sch_resource_booking',
    meterEventType: 'api_call',
  });
}

export async function listResourceSchedule(
  tenantId: string,
  actorId: string,
  resourceId: string,
  fromIso: string,
  toIso: string,
): Promise<ResourceBooking[]> {
  return runCrudOperation({
    configName: 'resource-conflict-engine',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const from = Date.parse(fromIso);
      const to = Date.parse(toIso);
      if (Number.isNaN(from) || Number.isNaN(to)) {
        throw new AppError('invalid range', ErrorCode.BAD_REQUEST);
      }
      return [...bookings.values()]
        .filter((b) => {
          if (b.tenantId !== tenantId || b.resourceId !== resourceId) return false;
          if (b.status === 'released') return false;
          const s = Date.parse(b.startAt);
          return s >= from && s <= to;
        })
        .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
    },
    auditAction: 'data.read',
    auditResource: 'sch_resource_booking',
    meterEventType: 'api_call',
  });
}
