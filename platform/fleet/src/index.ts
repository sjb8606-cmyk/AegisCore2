import { withTenantQuery } from '@platform/tenancy';
import * as fs from 'fs';
import * as path from 'path';
import { AppError, ErrorCode } from '@platform/utils';

export function parseUserId(userId: any): string {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof userId === 'string' && uuidRegex.test(userId)) return userId;
  throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, ErrorCode.BAD_REQUEST);
}

function loadConfig() {
  try {
    const configPath = path.join(process.cwd(), 'config', 'fleet.json');
    if (fs.existsSync(configPath)) return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return { enabled: true, limits: { vehicles: 10000 } };
}

export async function createVehicle(tenantId: string, userId: string, data: any) {
  const cfg = loadConfig();
  if (!cfg.enabled) throw new AppError('Fleet vertical is disabled', ErrorCode.FORBIDDEN);

  const countRes = await withTenantQuery('SELECT COUNT(*) as count FROM vehicles WHERE tenant_id = $1 AND deleted_at IS NULL', [tenantId], tenantId);
  if (parseInt(countRes[0]?.count || '0', 10) >= cfg.limits.vehicles) {
    throw new AppError('Fleet vehicle capacity limits reached', ErrorCode.RATE_LIMITED);
  }

  const vehicleId = crypto.randomUUID();
  const insertQuery = `
    INSERT INTO vehicles (id, tenant_id, vehicle_number, vin, make, model, year, license_plate, fuel_type, odometer_km)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *;
  `;
  const result = await withTenantQuery(insertQuery, [
    vehicleId, tenantId, data.vehicleNumber, data.vin || null, data.make, data.model, data.year,
    data.licensePlate || null, data.fuelType || null, data.odometerKm || 0
  ], tenantId);

  return result[0];
}

export async function assignDriver(tenantId: string, vehicleId: string, driverId: string, assignedBy: string) {
  const cleanDriverId = parseUserId(driverId);
  const cleanAssignedBy = parseUserId(assignedBy);

  // Atomic lock to prevent double-assignments on the same vehicle
  const vehicleRes = await withTenantQuery('SELECT status, assigned_to, odometer_km FROM vehicles WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [vehicleId, tenantId], tenantId);
  const vehicle = vehicleRes[0];

  if (!vehicle) throw new AppError('Vehicle not found', ErrorCode.NOT_FOUND);
  if (vehicle.status !== 'active') throw new AppError('Vehicle is not active for dispatch', ErrorCode.BAD_REQUEST);
  if (vehicle.assigned_to) throw new AppError('Vehicle is already actively assigned to another driver', ErrorCode.CONFLICT);

  const assignmentId = crypto.randomUUID();
  await withTenantQuery(`
    INSERT INTO driver_assignments (id, tenant_id, vehicle_id, driver_id, assigned_by, start_km)
    VALUES ($1, $2, $3, $4, $5, $6);
  `, [assignmentId, tenantId, vehicleId, cleanDriverId, cleanAssignedBy, vehicle.odometer_km], tenantId);

  const updatedVehicle = await withTenantQuery(`
    UPDATE vehicles SET assigned_to = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND tenant_id = $3 RETURNING *;
  `, [cleanDriverId, vehicleId, tenantId], tenantId);

  return { success: true, assignment_id: assignmentId, vehicle: updatedVehicle[0] };
}

export async function scheduleMaintenance(tenantId: string, vehicleId: string, data: any) {
  const maintenanceId = crypto.randomUUID();

  const insertQuery = `
    INSERT INTO fleet_maintenance (id, tenant_id, vehicle_id, maintenance_type, description, odometer_km, next_due_km)
    VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *;
  `;
  const result = await withTenantQuery(insertQuery, [
    maintenanceId, tenantId, vehicleId, data.maintenanceType, data.description, data.odometerKm || null, data.nextDueKm || null
  ], tenantId);

  return result[0];
}

export async function getVehicleDetails(tenantId: string, id: string) {
  const res = await withTenantQuery('SELECT * FROM vehicles WHERE id = $1 AND tenant_id = $2', [id, tenantId], tenantId);
  const vehicle = res[0];
  if (!vehicle) throw new AppError('Vehicle not found', ErrorCode.NOT_FOUND);

  const activeAssignment = await withTenantQuery('SELECT * FROM driver_assignments WHERE vehicle_id = $1 AND tenant_id = $2 AND returned_at IS NULL', [id, tenantId], tenantId);
  const maintenance = await withTenantQuery('SELECT * FROM fleet_maintenance WHERE vehicle_id = $1 AND tenant_id = $2 AND status IN (\'scheduled\', \'in_progress\') ORDER BY created_at DESC', [id, tenantId], tenantId);

  return { ...vehicle, active_assignment: activeAssignment[0] || null, pending_maintenance: maintenance };
}
