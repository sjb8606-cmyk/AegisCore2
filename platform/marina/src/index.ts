import { withTenantQuery } from '@platform/tenancy';
import { z } from 'zod';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export class AppError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export const VesselSchema = z.object({
  name: z.string().min(1),
  owner_name: z.string().min(1),
  length_m: z.number().positive(),
  draft_m: z.number().positive(),
  beam_m: z.number().positive().optional(),
});

export const ReservationSchema = z.object({
  slip_id: z.string().uuid(),
  vessel_id: z.string().uuid(),
  start_time: z.string().datetime(),
  end_time: z.string().datetime(),
  guest_name: z.string().optional(),
  guest_email: z.string().email().optional(),
});

export function isValidUuid(id: any): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return typeof id === 'string' && uuidRegex.test(id);
}

export function parseUserId(userId: any): string {
  if (isValidUuid(userId)) return userId;
  throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, 'BAD_REQUEST');
}

function loadConfig() {
  const configPath = path.join(process.cwd(), 'config', 'marina.json');
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return { enabled: true, tiers: { berthReservations: true, fuelTracking: true } };
}

export async function createSlip(tenantId: string, data: any) {
  const slipId = crypto.randomUUID();
  const res = await withTenantQuery(`
    INSERT INTO marina_slips (id, tenant_id, name, size_limit_m, depth_limit_m)
    VALUES ($1, $2, $3, $4, $5) RETURNING *;
  `, [slipId, tenantId, data.name, data.size_limit_m, data.depth_limit_m], tenantId);
  return res[0];
}

export async function registerVessel(tenantId: string, data: any) {
  const parsed = VesselSchema.parse(data);
  const vesselId = crypto.randomUUID();

  const res = await withTenantQuery(`
    INSERT INTO marina_vessels (id, tenant_id, name, owner_name, length_m, draft_m, beam_m)
    VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *;
  `, [vesselId, tenantId, parsed.name, parsed.owner_name, parsed.length_m, parsed.draft_m, parsed.beam_m || null], tenantId);

  return res[0];
}

export async function reserveBerth(tenantId: string, data: any) {
  const cfg = loadConfig();
  if (!cfg.enabled || !cfg.tiers.berthReservations) {
    throw new AppError('Berth reservations disabled under current tier config.', 'FORBIDDEN');
  }

  const parsed = ReservationSchema.parse(data);

  const slipRes = await withTenantQuery('SELECT * FROM marina_slips WHERE id = $1 AND tenant_id = $2', [parsed.slip_id, tenantId], tenantId);
  const slip = slipRes[0];
  const vesselRes = await withTenantQuery('SELECT * FROM marina_vessels WHERE id = $1 AND tenant_id = $2', [parsed.vessel_id, tenantId], tenantId);
  const vessel = vesselRes[0];

  if (!slip || !vessel) throw new AppError('Slip or Vessel not found', 'NOT_FOUND');

  // Strict Physical constraint validation: Check vessel draft against slip depth limit
  if (parseFloat(slip.depth_limit_m) < parseFloat(vessel.draft_m)) {
    throw new AppError(`Physical clearance block: Vessel draft (${vessel.draft_m}m) exceeds Slip depth clearance (${slip.depth_limit_m}m).`, 'BAD_REQUEST');
  }

  // Strict physical dimension validation: Check vessel length against slip size limit
  if (parseFloat(slip.size_limit_m) < parseFloat(vessel.length_m)) {
    throw new AppError(`Size clearance block: Vessel length (${vessel.length_m}m) exceeds Slip dimension limit (${slip.size_limit_m}m).`, 'BAD_REQUEST');
  }

  // Concurrency check: Ensure no schedule overlap exists
  const conflict = await withTenantQuery(`
    SELECT * FROM marina_reservations 
    WHERE slip_id = $1 
      AND tenant_id = $2
      AND status != 'canceled'
      AND NOT (end_time <= $3 OR start_time >= $4);
  `, [parsed.slip_id, tenantId, parsed.start_time, parsed.end_time], tenantId);

  if (conflict && conflict.length > 0) {
    throw new AppError('Collision: The requested slip is already reserved during this time window.', 'BAD_REQUEST');
  }

  const res = await withTenantQuery(`
    SELECT COUNT(*) as seq FROM marina_reservations WHERE tenant_id = $1 AND DATE(created_at) = CURRENT_DATE
  `, [tenantId], tenantId);
  const seq = (parseInt(res[0]?.seq || '0', 10) + 1).toString().padStart(4, '0');
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const confirmationNumber = `MAR-${dateStr}-${seq}`;

  const reservationId = crypto.randomUUID();
  const reservationRes = await withTenantQuery(`
    INSERT INTO marina_reservations (id, tenant_id, slip_id, vessel_id, confirmation_number, start_time, end_time, status, guest_name, guest_email)
    VALUES ($1, $2, $3, $4, $5, $6, $7, 'booked', $8, $9) RETURNING *;
  `, [reservationId, tenantId, parsed.slip_id, parsed.vessel_id, confirmationNumber, parsed.start_time, parsed.end_time, parsed.guest_name || null, parsed.guest_email || null], tenantId);

  await withTenantQuery(`
    UPDATE marina_slips SET status = 'reserved', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2;
  `, [parsed.slip_id, tenantId], tenantId);

  return reservationRes[0];
}

export async function logFuelUsage(tenantId: string, data: any, userId: string) {
  const cfg = loadConfig();
  if (!cfg.enabled || !cfg.tiers.fuelTracking) {
    throw new AppError('Fuel tracking disabled under current tier config.', 'FORBIDDEN');
  }

  const logId = crypto.randomUUID();
  const cleanUserId = parseUserId(userId);

  const res = await withTenantQuery(`
    INSERT INTO marina_fuel_logs (id, tenant_id, vessel_id, liters, price_per_liter, logged_by)
    VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;
  `, [logId, tenantId, data.vessel_id, data.liters, data.price_per_liter, cleanUserId], tenantId);

  return res[0];
}

export async function getMarinaLedger(tenantId: string, slipId: string) {
  if (!isValidUuid(slipId)) throw new AppError('Invalid Slip ID format.', 'BAD_REQUEST');

  const slipRes = await withTenantQuery('SELECT * FROM marina_slips WHERE id = $1 AND tenant_id = $2', [slipId, tenantId], tenantId);
  const slip = slipRes[0];
  if (!slip) throw new AppError('Slip not found.', 'NOT_FOUND');

  const reservations = await withTenantQuery(`
    SELECT r.*, v.name as vessel_name, v.owner_name, v.length_m, v.draft_m
    FROM marina_reservations r
    JOIN marina_vessels v ON r.vessel_id = v.id
    WHERE r.slip_id = $1 AND r.tenant_id = $2
    ORDER BY r.start_time ASC;
  `, [slipId, tenantId], tenantId);

  return { ...slip, reservations };
}
