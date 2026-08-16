import { withTenantQuery } from '@platform/tenancy';
import { AppError, ErrorCode, parseUserId, isValidUuid } from '@platform/utils';
export { AppError, ErrorCode };
import { z } from 'zod';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export const FitnessConfigSchema = z.object({
  enabled: z.boolean(),
  tiers: z.object({
    memberships: z.boolean().default(true),
    classScheduling: z.boolean().default(true),
    trainerManagement: z.boolean().default(true),
    checkIns: z.boolean().default(true),
    attendanceTracking: z.boolean().default(true),
    basicPlans: z.boolean().default(true),
    waitlists: z.boolean().default(true),
    personalTraining: z.boolean().default(true),
    packages: z.boolean().default(false),
    lockerManagement: z.boolean().default(false),
    workoutPrograms: z.boolean().default(false),
    progressTracking: z.boolean().default(false),
    fitnessChallenges: z.boolean().default(false),
    leaderboards: z.boolean().default(false),
    auditTrail: z.boolean().default(false),
    advancedAnalytics: z.boolean().default(false),
    dynamicPricing: z.boolean().default(false),
  }),
  limits: z.object({
    membersPerTenant: z.number().default(500000),
    classesPerMonth: z.number().default(200000),
    checkInsPerDay: z.number().default(1000000),
  }),
  thresholds: z.object({
    classOverbookingLimit: z.number().default(1.0),
    autoWaitlistThreshold: z.number().default(1.0),
    lateCancelWindowHours: z.number().default(12),
  }),
});

export type FitnessConfig = z.infer<typeof FitnessConfigSchema>;

function loadConfig(): FitnessConfig {
  const configPath = path.join(process.cwd(), 'config', 'fitness.json');
  try {
    if (fs.existsSync(configPath)) {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return FitnessConfigSchema.parse(raw);
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return {
    enabled: true,
    tiers: {
      memberships: true,
      classScheduling: true,
      trainerManagement: true,
      checkIns: true,
      attendanceTracking: true,
      basicPlans: true,
      waitlists: true,
      personalTraining: true,
      packages: false,
      lockerManagement: false,
      workoutPrograms: false,
      progressTracking: false,
      fitnessChallenges: false,
      leaderboards: false,
      auditTrail: true,
      advancedAnalytics: false,
      dynamicPricing: false
    },
    limits: { membersPerTenant: 500000, classesPerMonth: 200000, checkInsPerDay: 1000000 },
    thresholds: { classOverbookingLimit: 1.0, autoWaitlistThreshold: 1.0, lateCancelWindowHours: 12 }
  };
}

export async function createMember(tenantId: string, data: any) {
  const memberId = crypto.randomUUID();
  const res = await withTenantQuery(`
    INSERT INTO fit_members (id, tenant_id, name, email)
    VALUES ($1, $2, $3, $4) RETURNING *;
  `, [memberId, tenantId, data.name, data.email], tenantId);
  return res[0];
}

export async function createClass(tenantId: string, data: any) {
  const classId = crypto.randomUUID();
  const formattedTime = new Date(data.scheduled_at).toISOString();

  const res = await withTenantQuery(`
    INSERT INTO fit_classes (id, tenant_id, name, trainer_name, capacity, scheduled_at)
    VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;
  `, [classId, tenantId, data.name, data.trainer_name, data.capacity, formattedTime], tenantId);
  return res[0];
}

export async function bookClass(tenantId: string, input: any) {
  const cfg = loadConfig();
  if (!cfg.enabled) throw new AppError('Fitness module disabled', 'FORBIDDEN');

  if (!isValidUuid(input.class_id) || !isValidUuid(input.member_id)) {
    throw new AppError('Invalid ID formats (Class or Member ID).', 'BAD_REQUEST');
  }

  // 1. Fetch Class Capacity details
  const classRes = await withTenantQuery(`
    SELECT * FROM fit_classes WHERE id = $1 AND tenant_id = $2;
  `, [input.class_id, tenantId], tenantId);
  const classData = classRes[0];
  if (!classData) throw new AppError('Class not found.', 'NOT_FOUND');

  // 2. Count existing booked slots (exclude canceled or waitlisted slots)
  const bookingsCountRes = await withTenantQuery(`
    SELECT COUNT(*) as count 
    FROM fit_bookings 
    WHERE class_id = $1 AND tenant_id = $2 AND status = 'booked';
  `, [input.class_id, tenantId], tenantId);

  const currentBookings = parseInt(bookingsCountRes[0]?.count || '0', 10);
  const maxCapacity = parseInt(classData.capacity, 10);

  let status = 'booked';
  if (currentBookings >= maxCapacity) {
    if (cfg.tiers.waitlists) {
      status = 'waitlisted';
    } else {
      throw new AppError('This class has reached its maximum capacity.', 'BAD_REQUEST');
    }
  }

  const bookingId = crypto.randomUUID();
  const res = await withTenantQuery(`
    INSERT INTO fit_bookings (id, tenant_id, class_id, member_id, status)
    VALUES ($1, $2, $3, $4, $5) RETURNING *;
  `, [bookingId, tenantId, input.class_id, input.member_id, status], tenantId);

  return res[0];
}

// Immutable Check-In: Records attendance for booked class sessions
export async function registerCheckIn(tenantId: string, data: any) {
  if (!isValidUuid(data.class_id) || !isValidUuid(data.member_id)) {
    throw new AppError('Invalid ID formats (Class or Member ID).', 'BAD_REQUEST');
  }

  // Verify that the member has a 'booked' slot for this class
  const bookingRes = await withTenantQuery(`
    SELECT * 
    FROM fit_bookings 
    WHERE class_id = $1 AND member_id = $2 AND tenant_id = $3 AND status = 'booked';
  `, [data.class_id, data.member_id, tenantId], tenantId);

  if (!bookingRes || bookingRes.length === 0) {
    throw new AppError('No active class booking found for this member.', 'BAD_REQUEST');
  }

  // Deduplicate: prevent checking in twice for the same class
  const existingCheckIn = await withTenantQuery(`
    SELECT * 
    FROM fit_check_ins 
    WHERE class_id = $1 AND member_id = $2 AND tenant_id = $3;
  `, [data.class_id, data.member_id, tenantId], tenantId);

  if (existingCheckIn && existingCheckIn.length > 0) {
    throw new AppError('Member is already checked into this class.', 'BAD_REQUEST');
  }

  const checkInId = crypto.randomUUID();
  const res = await withTenantQuery(`
    INSERT INTO fit_check_ins (id, tenant_id, member_id, class_id)
    VALUES ($1, $2, $3, $4) RETURNING *;
  `, [checkInId, tenantId, data.member_id, data.class_id], tenantId);

  return res[0];
}

export async function getClassLedger(tenantId: string, classId: string) {
  if (!isValidUuid(classId)) throw new AppError('Invalid Class ID format.', 'BAD_REQUEST');

  const classRes = await withTenantQuery(`
    SELECT * FROM fit_classes WHERE id = $1 AND tenant_id = $2;
  `, [classId, tenantId], tenantId);

  const classData = classRes[0];
  if (!classData) throw new AppError('Class not found.', 'NOT_FOUND');

  // Retrieve chronological bookings
  const bookings = await withTenantQuery(`
    SELECT b.*, m.name as member_name, m.email as member_email
    FROM fit_bookings b
    JOIN fit_members m ON b.member_id = m.id
    WHERE b.class_id = $1 AND b.tenant_id = $2
    ORDER BY b.created_at ASC;
  `, [classId, tenantId], tenantId);

  // Retrieve attendance log
  const checkIns = await withTenantQuery(`
    SELECT c.*, m.name as member_name
    FROM fit_check_ins c
    JOIN fit_members m ON c.member_id = m.id
    WHERE c.class_id = $1 AND c.tenant_id = $2
    ORDER BY c.checked_at ASC;
  `, [classId, tenantId], tenantId);

  return {
    ...classData,
    bookings,
    check_ins: checkIns
  };
}
