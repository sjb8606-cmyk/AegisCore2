import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { withTenantQuery } from '../../tenancy/src/index';
import { AppError, ErrorCode } from '../../utils/src/index';
export { AppError, ErrorCode };

export const EmployeeInputSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  jobTitle: z.string().optional(),
  department: z.string().optional(),
  employmentType: z.string().optional(),
});

export const TimeEntryInputSchema = z.object({
  clockIn: z.string().datetime(),
  notes: z.string().optional(),
});

export const HrConfigSchema = z.object({
  enabled: z.boolean(),
  tiers: z.object({
    timeTracking: z.boolean().default(true),
    leaveManagement: z.boolean().default(false),
    documentStorage: z.boolean().default(false),
    performanceReviews: z.boolean().default(false),
    payrollReporting: z.boolean().default(false),
    onboardingChecklists: z.boolean().default(false),
    auditTrail: z.boolean().default(false),
    encryptedPersonalData: z.boolean().default(false),
    orgChart: z.boolean().default(false),
    expenseReporting: z.boolean().default(false),
  }),
  limits: z.object({
    employeeCount: z.number().default(25),
    documentRetentionYears: z.number().default(7),
    leaveTypesCount: z.number().default(3),
  }),
});

export type HrConfig = z.infer<typeof HrConfigSchema>;

let cachedConfig: HrConfig | null = null;

export function loadConfig(): HrConfig {
  if (cachedConfig) return cachedConfig;
  const configPath = path.resolve(process.cwd(), 'config/hr.json');
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8');
      cachedConfig = HrConfigSchema.parse(JSON.parse(raw));
      return cachedConfig;
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }

  cachedConfig = HrConfigSchema.parse({
    enabled: true,
    tiers: {
      timeTracking: true,
      leaveManagement: false,
      documentStorage: false,
      performanceReviews: false,
      payrollReporting: false,
      onboardingChecklists: false,
      auditTrail: false,
      encryptedPersonalData: false,
      orgChart: false,
      expenseReporting: false,
    },
    limits: {
      employeeCount: 25,
      documentRetentionYears: 7,
      leaveTypesCount: 3,
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

export class HrService {
  static async createEmployee(tenantId: string, userId: string, data: any) {
    const config = loadConfig();
    if (!config.enabled) {
      throw new AppError('HR platform globally disabled', ErrorCode.FORBIDDEN);
    }

    const input = EmployeeInputSchema.parse(data);

    // Limit enforcement check
    const currentCount = await this.getTenantUsageThisMonth(tenantId);
    if (currentCount >= config.limits.employeeCount) {
      throw new AppError(`Monthly active employee limit reached (${config.limits.employeeCount})`, ErrorCode.FORBIDDEN);
    }

    const sql = `
      INSERT INTO employees (tenant_id, first_name, last_name, email, phone, job_title, department, employment_type)
      VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;
    const params = [
      tenantId,
      input.firstName,
      input.lastName,
      input.email,
      input.phone || null,
      input.jobTitle || null,
      input.department || null,
      input.employmentType || null
    ];

    const rows = await withTenantQuery(sql, params, tenantId);
    if (!rows || rows.length === 0) {
      throw new AppError('Failed to record employee details', ErrorCode.INTERNAL);
    }

    return rows[0];
  }

  static async clockIn(tenantId: string, employeeId: string, data: any) {
    const config = loadConfig();
    if (!config.enabled) {
      throw new AppError('HR platform globally disabled', ErrorCode.FORBIDDEN);
    }

    if (!config.tiers.timeTracking) {
      throw new AppError('Time tracking features are blocked on current tier', ErrorCode.FORBIDDEN);
    }

    const input = TimeEntryInputSchema.parse(data);

    const employee = await this.setupMockEmployee(tenantId);
    const resolvedEmployeeId = employeeId && employeeId !== 'clock' ? employeeId : employee.id;

    const checkSql = `
      SELECT COUNT(*)::int as count 
      FROM time_entries 
      WHERE tenant_id = $1::uuid AND employee_id = $2::uuid AND clock_out IS NULL
    `;
    const checkRows = await withTenantQuery(checkSql, [tenantId, resolvedEmployeeId], tenantId);
    if (checkRows && checkRows[0]?.count > 0) {
      throw new AppError('Employee is already clocked in with an active shift', ErrorCode.CONFLICT);
    }

    const sql = `
      INSERT INTO time_entries (tenant_id, employee_id, clock_in, notes)
      VALUES ($1::uuid, $2::uuid, $3::timestamptz, $4)
      RETURNING *
    `;
    const params = [tenantId, resolvedEmployeeId, input.clockIn, input.notes || null];

    const rows = await withTenantQuery(sql, params, tenantId);
    if (!rows || rows.length === 0) {
      throw new AppError('Failed to log clock-in event', ErrorCode.INTERNAL);
    }

    return rows[0];
  }

  static async fetchEmployees(tenantId: string): Promise<any[]> {
    const sql = `
      SELECT id, first_name, last_name, email, job_title, department, employment_type, start_date, created_at 
      FROM employees 
      WHERE tenant_id = $1::uuid AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT 100
    `;
    return await withTenantQuery(sql, [tenantId], tenantId);
  }

  static async getTenantUsageThisMonth(tenantId: string): Promise<number> {
    const sql = `
      SELECT COUNT(*)::int as count 
      FROM employees 
      WHERE tenant_id = $1::uuid AND deleted_at IS NULL
    `;
    const rows = await withTenantQuery(sql, [tenantId], tenantId);
    return rows[0]?.count || 0;
  }

  static async setupMockEmployee(tenantId: string): Promise<any> {
    const checkSql = `SELECT id FROM employees WHERE tenant_id = $1::uuid LIMIT 1`;
    const checkRows = await withTenantQuery(checkSql, [tenantId], tenantId);
    if (checkRows && checkRows.length > 0) {
      return checkRows[0];
    }

    const sql = `
      INSERT INTO employees (tenant_id, first_name, last_name, email, job_title, department, employment_type)
      VALUES ($1::uuid, 'Founder', 'Admin', 'founder@ruthless-saas.local', 'Central Executor', 'Security', 'full_time')
      RETURNING *
    `;
    const rows = await withTenantQuery(sql, [tenantId], tenantId);
    return rows[0];
  }
}
