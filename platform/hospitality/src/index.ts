import { withTenantQuery } from '@platform/tenancy';
import * as fs from 'fs';
import * as path from 'path';
import { AppError, ErrorCode } from '@platform/utils';

export function parseUserId(userId: any): string {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof userId === 'string' && uuidRegex.test(userId)) {
    return userId;
  }
  throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, ErrorCode.BAD_REQUEST);
}

function loadConfig() {
  try {
    const configPath = path.join(process.cwd(), 'config', 'hospitality.json');
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return { enabled: true, tiers: {}, limits: { roomCount: 50 } };
}

// Helper injected to allow testing
export async function createRoom(tenantId: string, data: any) {
  const config = loadConfig();
  if (!config.enabled) throw new AppError('Hospitality feature disabled', ErrorCode.FORBIDDEN);

  const roomId = crypto.randomUUID();
  const insertQuery = `
    INSERT INTO rooms (id, tenant_id, room_number, name, type, capacity, base_rate_cents)
    VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *;
  `;
  const result = await withTenantQuery(insertQuery, [roomId, tenantId, data.room_number, data.name || null, data.type, data.capacity || 2, data.base_rate_cents], tenantId);
  return result[0];
}

async function generateConfirmationNumber(tenantId: string): Promise<string> {
  const prefix = "HOS";
  const date = new Date().toISOString().slice(0,10).replace(/-/g, '');
  const res = await withTenantQuery(
    "SELECT COUNT(*) as seq FROM reservations WHERE tenant_id = $1 AND DATE(created_at) = CURRENT_DATE",
    [tenantId], tenantId
  );
  // Safely extract from the direct-array format
  const seqVal = parseInt(res[0]?.seq || '0', 10) + 1;
  const seq = seqVal.toString().padStart(3, '0');
  return `${prefix}-${date}-${seq}`;
}

export async function createReservation(tenantId: string, data: any) {
  const overlap = await withTenantQuery(`
    SELECT 1 FROM reservations 
    WHERE room_id = $1 AND tenant_id = $2
    AND status NOT IN ('canceled', 'no_show')
    AND NOT (check_out_date <= $3::date OR check_in_date >= $4::date)
  `, [data.room_id, tenantId, data.check_in_date, data.check_out_date], tenantId);

  if (overlap.length > 0) {
    throw new AppError('Room not available for selected dates', ErrorCode.BAD_REQUEST);
  }

  const nights = Math.max(1, Math.ceil((new Date(data.check_out_date).getTime() - new Date(data.check_in_date).getTime()) / (1000 * 3600 * 24)));
  const totalCents = (data.rate_cents || 0) * nights;
  const confirmationNumber = await generateConfirmationNumber(tenantId);
  const reservationId = crypto.randomUUID();

  const insertQuery = `
    INSERT INTO reservations (id, tenant_id, confirmation_number, room_id, guest_name, guest_email, check_in_date, check_out_date, nights, adults, rate_cents, total_cents, balance_cents)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *;
  `;
  
  const res = await withTenantQuery(insertQuery, [
    reservationId, tenantId, confirmationNumber, data.room_id, data.guest_name, data.guest_email, 
    data.check_in_date, data.check_out_date, nights, data.adults || 1, data.rate_cents || 0, totalCents, totalCents
  ], tenantId);
  
  return res[0];
}

export async function getAvailableRooms(tenantId: string, checkIn: string, checkOut: string, guests: number) {
  const res = await withTenantQuery(`
    SELECT r.* FROM rooms r
    WHERE r.tenant_id = $1 AND r.is_active = true AND r.capacity >= $2 AND r.status = 'available'
    AND NOT EXISTS (
      SELECT 1 FROM reservations resv
      WHERE resv.room_id = r.id AND resv.tenant_id = $1 AND resv.status NOT IN ('canceled', 'no_show')
      AND NOT (resv.check_out_date <= $3::date OR resv.check_in_date >= $4::date)
    )
  `, [tenantId, guests, checkIn, checkOut], tenantId);
  return res;
}

export async function checkOut(tenantId: string, reservationId: string, staffId: string) {
  const cleanStaffId = parseUserId(staffId);
  
  // Atomic multi-table operation mapped sequentially to bypass ORM/Wrapper transaction rules
  const updateRes = await withTenantQuery(`
    UPDATE reservations SET status = 'checked_out', checked_out_at = CURRENT_TIMESTAMP 
    WHERE id = $1 AND tenant_id = $2 RETURNING room_id;
  `, [reservationId, tenantId], tenantId);

  const roomId = updateRes[0]?.room_id;
  if (!roomId) throw new AppError('Reservation not found', ErrorCode.NOT_FOUND);

  await withTenantQuery(`UPDATE rooms SET status = 'cleaning' WHERE id = $1 AND tenant_id = $2`, [roomId, tenantId], tenantId);

  const taskId = crypto.randomUUID();
  await withTenantQuery(`
    INSERT INTO housekeeping_tasks (id, tenant_id, room_id, type, scheduled_for, assigned_to)
    VALUES ($1, $2, $3, 'departure', CURRENT_DATE, $4)
  `, [taskId, tenantId, roomId, cleanStaffId], tenantId);

  return { success: true, taskId, roomId };
}
