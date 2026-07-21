import { withTenantQuery } from '@platform/tenancy';
import * as fs from 'fs';
import * as path from 'path';
import { AppError, ErrorCode } from '@platform/utils';
export { AppError, ErrorCode };

export function parseUserId(userId: any): string {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof userId === 'string' && uuidRegex.test(userId)) return userId;
  throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, ErrorCode.BAD_REQUEST);
}

function loadConfig() {
  const configPath = path.join(process.cwd(), 'config', 'realestate.json');
  try {
    if (fs.existsSync(configPath)) return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return { enabled: true, tiers: { offerManagement: true }, limits: { listingCount: 50 } };
}

export async function createProperty(tenantId: string, agentId: string, data: any) {
  const cfg = loadConfig();
  if (!cfg.enabled) throw new AppError('Realestate is disabled', ErrorCode.FORBIDDEN);

  const cleanAgentId = parseUserId(agentId);
  const countRes = await withTenantQuery('SELECT COUNT(*) as count FROM properties WHERE tenant_id = $1 AND deleted_at IS NULL', [tenantId], tenantId);
  if (parseInt(countRes[0]?.count || '0', 10) >= cfg.limits.listingCount) {
    throw new AppError('Listing capacity limits reached', ErrorCode.FORBIDDEN);
  }

  const propertyId = crypto.randomUUID();
  const insertQuery = `
    INSERT INTO properties (id, tenant_id, agent_id, type, address, list_price_cents, bedrooms, bathrooms, sqft, description, geo_point)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, point($11, $12)) RETURNING *;
  `;
  const result = await withTenantQuery(insertQuery, [
    propertyId, tenantId, cleanAgentId, data.type, JSON.stringify(data.address || {}),
    data.list_price_cents, data.bedrooms || null, data.bathrooms || null, data.sqft || null,
    data.description || null, data.lon || 0.0, data.lat || 0.0
  ], tenantId);

  return result[0];
}

export async function bookShowing(tenantId: string, propertyId: string, data: any) {
  const cleanAgentId = parseUserId(data.agent_id);
  const showingId = crypto.randomUUID();

  const insertQuery = `
    INSERT INTO showings (id, tenant_id, property_id, agent_id, client_name, client_email, client_phone, scheduled_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz) RETURNING *;
  `;
  const result = await withTenantQuery(insertQuery, [
    showingId, tenantId, propertyId, cleanAgentId, data.client_name, data.client_email, data.client_phone || null, data.scheduled_at
  ], tenantId);

  return result[0];
}

export async function createOffer(tenantId: string, propertyId: string, data: any) {
  const cfg = loadConfig();
  if (!cfg.tiers.offerManagement) throw new AppError('Offer management disabled', ErrorCode.FORBIDDEN);

  const offerId = crypto.randomUUID();
  const insertQuery = `
    INSERT INTO offers (id, tenant_id, property_id, buyer_name, buyer_email, amount_cents)
    VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;
  `;
  const result = await withTenantQuery(insertQuery, [
    offerId, tenantId, propertyId, data.buyer_name, data.buyer_email, data.amount_cents
  ], tenantId);

  return result[0];
}

export async function acceptOffer(tenantId: string, offerId: string) {
  const cfg = loadConfig();
  if (!cfg.tiers.offerManagement) throw new AppError('Offer management disabled', ErrorCode.FORBIDDEN);

  const offerRes = await withTenantQuery('SELECT * FROM offers WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [offerId, tenantId], tenantId);
  const offer = offerRes[0];
  if (!offer) throw new AppError('Offer not found', ErrorCode.NOT_FOUND);

  // Atomic state: Reject others, accept this, spawn transaction, transition property
  await withTenantQuery(`UPDATE offers SET status = 'rejected' WHERE property_id = $1 AND id != $2 AND status = 'pending' AND tenant_id = $3`, [offer.property_id, offerId, tenantId], tenantId);
  await withTenantQuery(`UPDATE offers SET status = 'accepted', accepted_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2`, [offerId, tenantId], tenantId);

  const txId = crypto.randomUUID();
  const txRes = await withTenantQuery(`
    INSERT INTO transactions (id, tenant_id, property_id, offer_id, sale_price_cents, status)
    VALUES ($1, $2, $3, $4, $5, 'open') RETURNING *;
  `, [txId, tenantId, offer.property_id, offerId, offer.amount_cents], tenantId);

  await withTenantQuery(`UPDATE properties SET status = 'pending', sold_price_cents = $1, sold_at = CURRENT_TIMESTAMP WHERE id = $2 AND tenant_id = $3`, [offer.amount_cents, offer.property_id, tenantId], tenantId);

  return txRes[0];
}

export async function geoSearchProperties(tenantId: string, lat: number, lon: number, radiusKm: number) {
  // Uses PostgreSQL native `<->` point distance calculation to safely GIST index without external PostGIS crashes
  // 1 degree latitude is ~111km. We use a bounding box radius distance approximation
  const degreeRadius = radiusKm / 111.0;
  const res = await withTenantQuery(`
    SELECT id, mls_number, list_price_cents, status, (geo_point <-> point($1, $2)) as distance
    FROM properties 
    WHERE tenant_id = $3 AND geo_point <@ box(point($1 - $4, $2 - $4), point($1 + $4, $2 + $4))
    AND status = 'active' AND deleted_at IS NULL
    ORDER BY distance ASC;
  `, [lon, lat, tenantId, degreeRadius], tenantId);

  return res;
}
