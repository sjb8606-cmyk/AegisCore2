/**
 * platform/fisheries/shift-huddle/src/index.ts
 */

import { z } from 'zod';
import { withTenantQuery } from '../../../tenancy/src/index';
import { loadConfig, AppError, ErrorCode } from '../../../utils/src/index';
import { NotificationService } from '../../../notifications/src/index';
export { AppError, ErrorCode };

const ConfigSchema = z.object({
  enabled: z.boolean(),
  handoffRecipient: z.string().email(),
});

export const StartShiftInputSchema = z.object({
  shiftDate: z.string().datetime(),
  shiftType: z.enum(['morning', 'afternoon', 'night']),
  staffCount: z.number().int().positive(),
  notes: z.string().optional(),
});

export const EndShiftInputSchema = z.object({
  handoffNotes: z.string().min(1),
  safetyIncidents: z.number().int().min(0).default(0),
  productionNotes: z.string().optional(),
});

function parseUserId(userId: any): string {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof userId === 'string' && uuidRegex.test(userId)) return userId;
  throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, ErrorCode.BAD_REQUEST);
}

function getConfig() {
  return loadConfig('fisheries-shift-huddle', ConfigSchema);
}

export class ShiftHuddleService {
  static async startShift(tenantId: string, userId: string, data: any) {
    const config = getConfig();
    if (!config.enabled) {
      throw new AppError('Shift huddle tracking disabled', ErrorCode.FORBIDDEN);
    }
    const cleanUserId = parseUserId(userId);
    const input = StartShiftInputSchema.parse(data);

    const existingOpen = await withTenantQuery(
      `SELECT id FROM fisheries_shift_huddles
       WHERE tenant_id = $1 AND shift_date = $2 AND shift_type = $3 AND status = 'open'
       LIMIT 1`,
      [tenantId, input.shiftDate, input.shiftType],
      tenantId
    );
    if (existingOpen && existingOpen.length > 0) {
      throw new AppError(
        `An open ${input.shiftType} shift already exists for ${input.shiftDate}.`,
        ErrorCode.CONFLICT
      );
    }

    const res = await withTenantQuery(
      `INSERT INTO fisheries_shift_huddles (
        tenant_id, shift_date, shift_type, staff_count, notes, status, started_by
      ) VALUES ($1, $2, $3, $4, $5, 'open', $6)
      RETURNING *`,
      [tenantId, input.shiftDate, input.shiftType, input.staffCount, input.notes ?? null, cleanUserId],
      tenantId
    );

    return res[0];
  }

  static async endShift(tenantId: string, shiftId: string, userId: string, data: any) {
    const cleanUserId = parseUserId(userId);
    const input = EndShiftInputSchema.parse(data);

    const shift = await ShiftHuddleService.getShift(tenantId, shiftId);
    if (shift.status !== 'open') {
      throw new AppError(`Shift ${shiftId} is already closed.`, ErrorCode.CONFLICT);
    }

    const res = await withTenantQuery(
      `UPDATE fisheries_shift_huddles
       SET status = 'closed', handoff_notes = $1, safety_incidents = $2,
           production_notes = $3, ended_by = $4, ended_at = NOW()
       WHERE tenant_id = $5 AND id = $6
       RETURNING *`,
      [input.handoffNotes, input.safetyIncidents, input.productionNotes ?? null, cleanUserId, tenantId, shiftId],
      tenantId
    );
    const closedShift = res[0];

    const config = getConfig();
    const urgencyPrefix = input.safetyIncidents > 0 ? '[SAFETY INCIDENT REPORTED] ' : '';
    await NotificationService.send(tenantId, {
      recipient: config.handoffRecipient,
      channel: 'email',
      subject: `${urgencyPrefix}Shift handoff — ${shift.shift_type} shift, ${shift.shift_date}`,
      body: `Handoff notes: ${input.handoffNotes}\nSafety incidents: ${input.safetyIncidents}` +
        (input.productionNotes ? `\nProduction notes: ${input.productionNotes}` : ''),
    });

    return closedShift;
  }

  static async getActiveShift(tenantId: string, shiftType: 'morning' | 'afternoon' | 'night') {
    const res = await withTenantQuery(
      `SELECT * FROM fisheries_shift_huddles
       WHERE tenant_id = $1 AND shift_type = $2 AND status = 'open'
       ORDER BY started_at DESC LIMIT 1`,
      [tenantId, shiftType],
      tenantId
    );
    return res && res.length > 0 ? res[0] : null;
  }

  static async getShift(tenantId: string, shiftId: string) {
    const res = await withTenantQuery(
      'SELECT * FROM fisheries_shift_huddles WHERE tenant_id = $1 AND id = $2',
      [tenantId, shiftId],
      tenantId
    );
    if (!res || res.length === 0) {
      throw new AppError(`Shift ${shiftId} not found`, ErrorCode.NOT_FOUND);
    }
    return res[0];
  }

  static async listShifts(
    tenantId: string,
    filters: { shiftType?: 'morning' | 'afternoon' | 'night'; status?: 'open' | 'closed' } = {}
  ) {
    const conditions: string[] = ['tenant_id = $1'];
    const values: any[] = [tenantId];
    let idx = 2;

    if (filters.shiftType) {
      conditions.push(`shift_type = $${idx}`);
      values.push(filters.shiftType);
      idx += 1;
    }
    if (filters.status) {
      conditions.push(`status = $${idx}`);
      values.push(filters.status);
      idx += 1;
    }

    const sql = `
      SELECT * FROM fisheries_shift_huddles
      WHERE ${conditions.join(' AND ')}
      ORDER BY shift_date DESC, started_at DESC
    `;

    return await withTenantQuery(sql, values, tenantId);
  }
}
