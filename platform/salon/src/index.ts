import { withTenantQuery } from '@platform/tenancy';
import { AppError, ErrorCode } from '@platform/utils';
export { AppError, ErrorCode };
import { z } from 'zod';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export const SalonConfigSchema = z.object({
  enabled: z.boolean(),
  tiers: z.object({
    appointments: z.boolean().default(true),
    staffManagement: z.boolean().default(true),
    serviceCatalog: z.boolean().default(true),
    customerProfiles: z.boolean().default(true),
    basicPOS: z.boolean().default(true),
    loyaltyPoints: z.boolean().default(true),
    reminders: z.boolean().default(true),
    multiLocation: z.boolean().default(false),
    giftCards: z.boolean().default(false),
    packagesBundles: z.boolean().default(false),
    advancedScheduling: z.boolean().default(false),
    walkInQueue: z.boolean().default(false),
    dynamicPricing: z.boolean().default(false),
    auditTrail: z.boolean().default(false),
    analytics: z.boolean().default(false),
  }),
  limits: z.object({
    appointmentsPerMonth: z.number().default(200000),
    customersPerTenant: z.number().default(1000000),
    staffPerTenant: z.number().default(10000),
  }),
  thresholds: z.object({
    lateCancellationHours: z.number().default(24),
    noShowPenaltyEnabled: z.boolean().default(true),
  }),
});

export type SalonConfig = z.infer<typeof SalonConfigSchema>;

export function isValidUuid(id: any): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return typeof id === 'string' && uuidRegex.test(id);
}

export function parseUserId(userId: any): string {
  if (isValidUuid(userId)) return userId;
  throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, 'BAD_REQUEST');
}

function loadConfig(): SalonConfig {
  const configPath = path.join(process.cwd(), 'config', 'salon.json');
  try {
    if (fs.existsSync(configPath)) {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return SalonConfigSchema.parse(raw);
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return {
    enabled: true,
    tiers: {
      appointments: true,
      staffManagement: true,
      serviceCatalog: true,
      customerProfiles: true,
      basicPOS: true,
      loyaltyPoints: true,
      reminders: true,
      multiLocation: false,
      giftCards: false,
      packagesBundles: false,
      advancedScheduling: false,
      walkInQueue: false,
      dynamicPricing: false,
      auditTrail: true,
      analytics: false
    },
    limits: { appointmentsPerMonth: 200000, customersPerTenant: 1000000, staffPerTenant: 10000 },
    thresholds: { lateCancellationHours: 24, noShowPenaltyEnabled: true }
  };
}

export async function createCustomer(tenantId: string, data: any) {
  const customerId = crypto.randomUUID();
  const res = await withTenantQuery(`
    INSERT INTO salon_customers (id, tenant_id, name, email, phone)
    VALUES ($1, $2, $3, $4, $5) RETURNING *;
  `, [customerId, tenantId, data.name, data.email || null, data.phone || null], tenantId);
  return res[0];
}

export async function createStaff(tenantId: string, data: any) {
  const staffId = crypto.randomUUID();
  const res = await withTenantQuery(`
    INSERT INTO salon_staff (id, tenant_id, name, role)
    VALUES ($1, $2, $3, $4) RETURNING *;
  `, [staffId, tenantId, data.name, data.role], tenantId);
  return res[0];
}

export async function createService(tenantId: string, data: any) {
  const serviceId = crypto.randomUUID();
  const res = await withTenantQuery(`
    INSERT INTO salon_services (id, tenant_id, name, price_cents, duration_minutes)
    VALUES ($1, $2, $3, $4, $5) RETURNING *;
  `, [serviceId, tenantId, data.name, data.price_cents, data.duration_minutes], tenantId);
  return res[0];
}

export async function checkStaffAvailability(tenantId: string, staffId: string, scheduledAt: string): Promise<boolean> {
  const formattedTime = new Date(scheduledAt).toISOString();
  const res = await withTenantQuery(`
    SELECT COUNT(*) as count 
    FROM salon_appointments 
    WHERE staff_id = $1 AND scheduled_at = $2 AND tenant_id = $3 AND status != 'canceled';
  `, [staffId, formattedTime, tenantId], tenantId);
  
  return parseInt(res[0]?.count || '0', 10) === 0;
}

export async function bookAppointment(tenantId: string, input: any) {
  const cfg = loadConfig();
  if (!cfg.enabled) throw new AppError('Salon module disabled', 'FORBIDDEN');
  
  if (!isValidUuid(input.customer_id) || !isValidUuid(input.staff_id) || !isValidUuid(input.service_id)) {
    throw new AppError('Invalid ID formats (Customer, Staff, or Service).', 'BAD_REQUEST');
  }

  const isAvailable = await checkStaffAvailability(tenantId, input.staff_id, input.scheduled_at);
  if (!isAvailable) {
    throw new AppError('Stylist is not available at the requested time.', 'BAD_REQUEST');
  }

  const appointmentId = crypto.randomUUID();
  const formattedTime = new Date(input.scheduled_at).toISOString();

  const res = await withTenantQuery(`
    INSERT INTO salon_appointments (id, tenant_id, customer_id, staff_id, service_id, scheduled_at)
    VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;
  `, [appointmentId, tenantId, input.customer_id, input.staff_id, input.service_id, formattedTime], tenantId);

  return res[0];
}

// POS Checkout: Marks appointment completed, issues immutable sales ledger, awards loyalty points
export async function checkoutAndProcessPOS(tenantId: string, appointmentId: string) {
  const cfg = loadConfig();
  if (!isValidUuid(appointmentId)) throw new AppError('Invalid Appointment ID format.', 'BAD_REQUEST');

  const appRes = await withTenantQuery(`
    SELECT * FROM salon_appointments WHERE id = $1 AND tenant_id = $2;
  `, [appointmentId, tenantId], tenantId);

  const appointment = appRes[0];
  if (!appointment) throw new AppError('Appointment booking not found.', 'NOT_FOUND');
  if (appointment.status === 'completed') throw new AppError('Appointment has already been checked out.', 'BAD_REQUEST');

  const serviceRes = await withTenantQuery(`
    SELECT * FROM salon_services WHERE id = $1 AND tenant_id = $2;
  `, [appointment.service_id, tenantId], tenantId);
  const service = serviceRes[0];

  const totalCents = parseInt(service.price_cents, 10);
  
  // Loyalty Rules Engine: 1 loyalty point awarded for every $10.00 spent (1000 cents)
  let loyaltyPointsEarned = 0;
  if (cfg.tiers.loyaltyPoints) {
    loyaltyPointsEarned = Math.floor(totalCents / 1000);
  }

  const saleId = crypto.randomUUID();

  // Create immutable POS ledger ticket
  await withTenantQuery(`
    INSERT INTO salon_sales (id, tenant_id, appointment_id, total_cents, points_earned)
    VALUES ($1, $2, $3, $4, $5);
  `, [saleId, tenantId, appointmentId, totalCents, loyaltyPointsEarned], tenantId);

  // Update status
  await withTenantQuery(`
    UPDATE salon_appointments 
    SET status = 'completed', updated_at = CURRENT_TIMESTAMP 
    WHERE id = $1 AND tenant_id = $2;
  `, [appointmentId, tenantId], tenantId);

  // Award points to profile
  const updatedCustomer = await withTenantQuery(`
    UPDATE salon_customers 
    SET loyalty_points = loyalty_points + $1, updated_at = CURRENT_TIMESTAMP 
    WHERE id = $2 AND tenant_id = $3 RETURNING *;
  `, [loyaltyPointsEarned, appointment.customer_id, tenantId], tenantId);

  return {
    saleId,
    totalCents,
    loyaltyPointsEarned,
    customer: updatedCustomer[0]
  };
}

export async function getCustomerLedger(tenantId: string, customerId: string) {
  if (!isValidUuid(customerId)) throw new AppError('Invalid Customer ID format.', 'BAD_REQUEST');

  const customerRes = await withTenantQuery(`
    SELECT * FROM salon_customers WHERE id = $1 AND tenant_id = $2;
  `, [customerId, tenantId], tenantId);

  if (!customerRes || customerRes.length === 0) {
    throw new AppError('Customer profile not found.', 'NOT_FOUND');
  }

  const appointments = await withTenantQuery(`
    SELECT a.*, s.name as service_name, s.price_cents, st.name as stylist_name
    FROM salon_appointments a
    JOIN salon_services s ON a.service_id = s.id
    JOIN salon_staff st ON a.staff_id = st.id
    WHERE a.customer_id = $1 AND a.tenant_id = $2
    ORDER BY a.scheduled_at DESC;
  `, [customerId, tenantId], tenantId);

  return {
    ...customerRes[0],
    appointments
  };
}
