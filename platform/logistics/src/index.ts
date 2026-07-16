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
  const configPath = path.join(process.cwd(), 'config', 'logistics.json');
  try {
    if (fs.existsSync(configPath)) return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return { enabled: true, limits: { shipmentCount: 500 } };
}

async function generateTrackingNumber(tenantId: string): Promise<string> {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const res = await withTenantQuery(
    "SELECT COUNT(*) as seq FROM shipments WHERE tenant_id = $1 AND DATE(created_at) = CURRENT_DATE",
    [tenantId], tenantId
  );
  const seqVal = parseInt(res[0]?.seq || '0', 10) + 1;
  const seq = seqVal.toString().padStart(4, '0');
  return `SHIP-${date}-${seq}`;
}

export async function createShipment(tenantId: string, userId: string, data: any) {
  const cfg = loadConfig();
  if (!cfg.enabled) throw new AppError('Logistics vertical is disabled', ErrorCode.FORBIDDEN);

  const countRes = await withTenantQuery('SELECT COUNT(*) as count FROM shipments WHERE tenant_id = $1 AND deleted_at IS NULL', [tenantId], tenantId);
  if (parseInt(countRes[0]?.count || '0', 10) >= cfg.limits.shipmentCount) {
    throw new AppError('Shipment limits reached for current tier', ErrorCode.FORBIDDEN);
  }

  const trackingNumber = await generateTrackingNumber(tenantId);
  const trackingToken = crypto.randomUUID().replace(/-/g, '');
  const shipmentId = crypto.randomUUID();

  const insertQuery = `
    INSERT INTO shipments (id, tenant_id, tracking_number, tracking_token, sender_name, sender_address, recipient_name, recipient_address, recipient_email, weight_kg, description)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *;
  `;
  const result = await withTenantQuery(insertQuery, [
    shipmentId, tenantId, trackingNumber, trackingToken, data.senderName, JSON.stringify(data.senderAddress || {}),
    data.recipientName, JSON.stringify(data.recipientAddress || {}), data.recipientEmail || null, data.weightKg || null, data.description || null
  ], tenantId);

  return result[0];
}

export async function updateDriverLocation(tenantId: string, driverId: string, lat: number, lon: number) {
  const cleanDriverId = parseUserId(driverId);
  const locationId = crypto.randomUUID();

  const upsertQuery = `
    INSERT INTO driver_locations (id, tenant_id, driver_id, lat, lon)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (tenant_id, driver_id) DO UPDATE 
    SET lat = EXCLUDED.lat, lon = EXCLUDED.lon, updated_at = CURRENT_TIMESTAMP
    RETURNING *;
  `;
  const result = await withTenantQuery(upsertQuery, [locationId, tenantId, cleanDriverId, lat, lon], tenantId);
  return result[0];
}

export async function getPublicTracking(tenantId: string, trackingToken: string) {
  const res = await withTenantQuery(`
    SELECT id, tracking_number, status, recipient_name, updated_at
    FROM shipments 
    WHERE tracking_token = $1 AND tenant_id = $2 AND deleted_at IS NULL;
  `, [trackingToken, tenantId], tenantId);

  if (!res[0]) throw new AppError('Shipment tracking token not found', ErrorCode.NOT_FOUND);
  return res[0];
}
