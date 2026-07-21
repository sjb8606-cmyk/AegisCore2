import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { withTenantQuery } from '../../tenancy/src/index';
import { AppError, ErrorCode } from '../../utils/src/index';
export { AppError, ErrorCode };

export const AppointmentInputSchema = z.object({
  serviceId: z.string().uuid().optional(),
  staffId: z.string().uuid().optional(),
  clientName: z.string().min(1),
  clientEmail: z.string().email(),
  clientPhone: z.string().optional(),
  startAt: z.string().datetime(),
});

export const SchedulingConfigSchema = z.object({
  enabled: z.boolean(),
  tiers: z.object({
    multiStaff: z.boolean().default(false),
    recurringAppointments: z.boolean().default(false),
    groupBookings: z.boolean().default(false),
    paidAppointments: z.boolean().default(false),
    customFields: z.boolean().default(false),
    bufferTime: z.boolean().default(true),
    cancellationPolicy: z.boolean().default(false),
    reminderSequence: z.boolean().default(false),
    auditTrail: z.boolean().default(false),
    calendarSync: z.boolean().default(false),
  }),
  limits: z.object({
    serviceCount: z.number().default(5),
    staffCount: z.number().default(1),
    advanceBookingDays: z.number().default(30),
    appointmentDurationMinutes: z.array(z.number()).default([30, 60]),
    cancellationHours: z.number().default(24),
  }),
  timezone: z.string().default("America/Halifax"),
  workingHours: z.record(z.object({
    start: z.string(),
    end: z.string(),
    enabled: z.boolean().default(true),
  })),
});

export type SchedulingConfig = z.infer<typeof SchedulingConfigSchema>;

let cachedConfig: SchedulingConfig | null = null;

export function loadConfig(): SchedulingConfig {
  if (cachedConfig) return cachedConfig;
  const configPath = path.resolve(process.cwd(), 'config/scheduling.json');
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8');
      cachedConfig = SchedulingConfigSchema.parse(JSON.parse(raw));
      return cachedConfig;
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }

  cachedConfig = SchedulingConfigSchema.parse({
    enabled: true,
    tiers: {
      multiStaff: false,
      recurringAppointments: false,
      groupBookings: false,
      paidAppointments: false,
      customFields: false,
      bufferTime: true,
      cancellationPolicy: false,
      reminderSequence: false,
      auditTrail: false,
      calendarSync: false,
    },
    limits: {
      serviceCount: 5,
      staffCount: 1,
      advanceBookingDays: 30,
      appointmentDurationMinutes: [30, 60],
      cancellationHours: 24,
    },
    timezone: "America/Halifax",
    workingHours: {
      monday: { start: "09:00", end: "17:00", enabled: true }
    }
  });
  return cachedConfig;
}

function parseUserId(userId: any): string {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof userId === 'string' && uuidRegex.test(userId)) {
    return userId;
  }
  throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, ErrorCode.BAD_REQUEST);
}

export class SchedulingService {
  static async createAppointment(tenantId: string, userId: string, data: any) {
    const config = loadConfig();
    if (!config.enabled) {
      throw new AppError('Scheduling platform globally disabled', ErrorCode.FORBIDDEN);
    }

    const input = AppointmentInputSchema.parse(data);
    const cleanUserId = parseUserId(userId);

    const service = await this.setupMockService(tenantId);
    const serviceId = input.serviceId || service.id;

    const checkSql = `
      SELECT COUNT(*)::int as count 
      FROM appointments 
      WHERE tenant_id = $1::uuid AND start_at = $2::timestamptz AND status = 'confirmed'
    `;
    const checkRows = await withTenantQuery(checkSql, [tenantId, input.startAt], tenantId);
    if (checkRows && checkRows[0]?.count > 0) {
      throw new AppError('The requested time slot is no longer available', ErrorCode.CONFLICT);
    }

    const sql = `
      INSERT INTO appointments (tenant_id, service_id, staff_id, client_name, client_email, client_phone, start_at)
      VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7::timestamptz)
      RETURNING *
    `;
    const params = [
      tenantId,
      serviceId,
      input.staffId || null,
      input.clientName,
      input.clientEmail,
      input.clientPhone || null,
      input.startAt
    ];

    const rows = await withTenantQuery(sql, params, tenantId);
    if (!rows || rows.length === 0) {
      throw new AppError('Failed to record appointment details', ErrorCode.INTERNAL);
    }

    return rows[0];
  }

  static async fetchAppointments(tenantId: string): Promise<any[]> {
    const sql = `
      SELECT id, service_id, staff_id, client_name, client_email, start_at, status, created_at 
      FROM appointments 
      WHERE tenant_id = $1::uuid
      ORDER BY start_at DESC
      LIMIT 100
    `;
    return await withTenantQuery(sql, [tenantId], tenantId);
  }

  static async setupMockService(tenantId: string): Promise<any> {
    const checkSql = `SELECT id FROM scheduling_services WHERE tenant_id = $1::uuid LIMIT 1`;
    const checkRows = await withTenantQuery(checkSql, [tenantId], tenantId);
    if (checkRows && checkRows.length > 0) {
      return checkRows[0];
    }

    const sql = `
      INSERT INTO scheduling_services (tenant_id, name, duration_minutes)
      VALUES ($1::uuid, 'General Consultation', 30)
      RETURNING *
    `;
    const rows = await withTenantQuery(sql, [tenantId], tenantId);
    return rows[0];
  }
}
