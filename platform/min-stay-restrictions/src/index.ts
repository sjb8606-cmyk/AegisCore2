/**
 * platform/min-stay-restrictions (HOSP-04)
 *
 * Date-level restrictions: min stay, closed to arrival (CTA), closed to departure (CTD).
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('min-stay-restrictions');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  defaultMinStayNights: z.number().int().positive().default(1),
});

export interface DateRestriction {
  id: string;
  tenantId: string;
  roomTypeId: string;
  date: string; // YYYY-MM-DD
  minStayNights: number;
  closedToArrival: boolean;
  closedToDeparture: boolean;
  updatedAt: string;
}

const restrictions = new Map<string, DateRestriction>();

export function __resetMinStayStore(): void {
  restrictions.clear();
}

function key(tenantId: string, roomTypeId: string, date: string): string {
  return tenantId + ':' + roomTypeId + ':' + date;
}

function parseDateOnly(d: string): number {
  const t = Date.parse(d + (d.length === 10 ? 'T00:00:00Z' : ''));
  if (Number.isNaN(t)) {
    throw new AppError('invalid date', ErrorCode.BAD_REQUEST);
  }
  return t;
}

function nightsBetween(checkIn: string, checkOut: string): number {
  const a = parseDateOnly(checkIn);
  const b = parseDateOnly(checkOut);
  const nights = Math.round((b - a) / 86_400_000);
  if (nights <= 0) {
    throw new AppError('checkOut must be after checkIn', ErrorCode.BAD_REQUEST);
  }
  return nights;
}

function eachDate(checkIn: string, checkOut: string): string[] {
  const dates: string[] = [];
  let t = parseDateOnly(checkIn);
  const end = parseDateOnly(checkOut);
  while (t < end) {
    dates.push(new Date(t).toISOString().slice(0, 10));
    t += 86_400_000;
  }
  return dates;
}

export async function setRestriction(
  tenantId: string,
  actorId: string,
  input: {
    roomTypeId: string;
    date: string;
    minStayNights?: number;
    closedToArrival?: boolean;
    closedToDeparture?: boolean;
  },
): Promise<DateRestriction> {
  return runCrudOperation({
    configName: 'min-stay-restrictions',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('min-stay-restrictions', ConfigSchema);
      if (!input.roomTypeId?.trim() || !input.date?.trim()) {
        throw new AppError('roomTypeId and date required', ErrorCode.BAD_REQUEST);
      }
      parseDateOnly(input.date);
      const k = key(tenantId, input.roomTypeId, input.date);
      const existing = restrictions.get(k);
      const row: DateRestriction = {
        id: existing?.id || crypto.randomUUID(),
        tenantId,
        roomTypeId: input.roomTypeId,
        date: input.date,
        minStayNights:
          input.minStayNights ??
          existing?.minStayNights ??
          config.defaultMinStayNights,
        closedToArrival:
          input.closedToArrival ?? existing?.closedToArrival ?? false,
        closedToDeparture:
          input.closedToDeparture ?? existing?.closedToDeparture ?? false,
        updatedAt: new Date().toISOString(),
      };
      if (row.minStayNights < 1) {
        throw new AppError('minStayNights must be >= 1', ErrorCode.BAD_REQUEST);
      }
      restrictions.set(k, row);
      return row;
    },
    auditAction: 'data.updated',
    auditResource: 'hosp_date_restriction',
    meterEventType: 'api_call',
  });
}

export async function assertStayAllowed(
  tenantId: string,
  input: {
    roomTypeId: string;
    checkIn: string;
    checkOut: string;
  },
): Promise<{ allowed: boolean; nights: number; violations: string[] }> {
  const nights = nightsBetween(input.checkIn, input.checkOut);
  const dates = eachDate(input.checkIn, input.checkOut);
  const violations: string[] = [];

  const arrival = restrictions.get(
    key(tenantId, input.roomTypeId, input.checkIn),
  );
  if (arrival?.closedToArrival) {
    violations.push('Closed to arrival on ' + input.checkIn);
  }
  if (arrival && nights < arrival.minStayNights) {
    violations.push(
      'Min stay ' + arrival.minStayNights + ' nights on ' + input.checkIn,
    );
  }

  // CTD applies to the departure date (checkOut)
  const departure = restrictions.get(
    key(tenantId, input.roomTypeId, input.checkOut),
  );
  if (departure?.closedToDeparture) {
    violations.push('Closed to departure on ' + input.checkOut);
  }

  // Also enforce any higher min-stay on intermediate stay dates if configured
  for (const d of dates) {
    const r = restrictions.get(key(tenantId, input.roomTypeId, d));
    if (r && nights < r.minStayNights) {
      const msg = 'Min stay ' + r.minStayNights + ' nights on ' + d;
      if (!violations.includes(msg)) violations.push(msg);
    }
  }

  if (violations.length > 0) {
    throw new AppError(
      'Stay not allowed: ' + violations.join('; '),
      ErrorCode.FORBIDDEN,
    );
  }
  return { allowed: true, nights, violations: [] };
}

export async function validateStay(
  tenantId: string,
  actorId: string,
  input: {
    roomTypeId: string;
    checkIn: string;
    checkOut: string;
  },
): Promise<{ allowed: boolean; nights: number; violations: string[] }> {
  return runCrudOperation({
    configName: 'min-stay-restrictions',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => assertStayAllowed(tenantId, input),
    auditAction: 'bot.decision_recorded',
    auditResource: 'hosp_date_restriction',
    meterEventType: 'api_call',
  });
}

export async function getRestrictions(
  tenantId: string,
  actorId: string,
  roomTypeId: string,
  fromDate: string,
  toDate: string,
): Promise<DateRestriction[]> {
  return runCrudOperation({
    configName: 'min-stay-restrictions',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const from = parseDateOnly(fromDate);
      const to = parseDateOnly(toDate);
      return [...restrictions.values()]
        .filter((r) => {
          if (r.tenantId !== tenantId || r.roomTypeId !== roomTypeId) return false;
          const t = parseDateOnly(r.date);
          return t >= from && t <= to;
        })
        .sort((a, b) => a.date.localeCompare(b.date));
    },
    auditAction: 'data.read',
    auditResource: 'hosp_date_restriction',
    meterEventType: 'api_call',
  });
}
