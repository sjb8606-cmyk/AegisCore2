import { withTenantQuery } from '@platform/tenancy';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { AppError, ErrorCode } from '@platform/utils';

export function parseUserId(userId: any): string {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof userId === 'string' && uuidRegex.test(userId)) return userId;
  throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, ErrorCode.BAD_REQUEST);
}

function loadConfig() {
  const configPath = path.join(process.cwd(), 'config', 'assets.json');
  try {
    if (fs.existsSync(configPath)) return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return { enabled: true, tiers: { disposalWorkflow: true, assetAssignments: true }, limits: { assets: 100000 } };
}

export async function createAsset(tenantId: string, data: any) {
  const cfg = loadConfig();
  if (!cfg.enabled) throw new AppError('Asset management disabled', ErrorCode.FORBIDDEN);

  const countRes = await withTenantQuery('SELECT COUNT(*) as count FROM assets WHERE tenant_id = $1 AND deleted_at IS NULL', [tenantId], tenantId);
  if (parseInt(countRes[0]?.count || '0', 10) >= cfg.limits.assets) {
    throw new AppError('Asset registry limits reached', ErrorCode.RATE_LIMITED);
  }

  const assetId = crypto.randomUUID();
  const assetTag = data.asset_tag || `AST-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

  const insertQuery = `
    INSERT INTO assets (id, tenant_id, asset_tag, name, description, category, serial_number, purchase_price, current_value, status)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active') RETURNING *;
  `;
  const result = await withTenantQuery(insertQuery, [
    assetId, tenantId, assetTag, data.name, data.description || null, data.category || null, 
    data.serial_number || null, data.purchase_price || 0, data.purchase_price || 0
  ], tenantId);

  return result[0];
}

export async function assignAsset(tenantId: string, assetId: string, targetUserId: string, assignedBy: string) {
  const cfg = loadConfig();
  if (!cfg.tiers.assetAssignments) throw new AppError('Asset assignments disabled', ErrorCode.FORBIDDEN);

  const cleanTargetId = parseUserId(targetUserId);
  const cleanAssignerId = parseUserId(assignedBy);

  // Atomic lock on the asset to prevent double check-out
  const assetRes = await withTenantQuery('SELECT status, assigned_to FROM assets WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [assetId, tenantId], tenantId);
  const asset = assetRes[0];
  
  if (!asset) throw new AppError('Asset not found', ErrorCode.NOT_FOUND);
  if (asset.status !== 'active') throw new AppError('Asset is not in an active state for assignment', ErrorCode.BAD_REQUEST);
  if (asset.assigned_to) throw new AppError('Asset is already assigned out', ErrorCode.BAD_REQUEST);

  const assignmentId = crypto.randomUUID();
  await withTenantQuery(`
    INSERT INTO asset_assignments (id, tenant_id, asset_id, assigned_to, assigned_by)
    VALUES ($1, $2, $3, $4, $5);
  `, [assignmentId, tenantId, assetId, cleanTargetId, cleanAssignerId], tenantId);

  const updatedAsset = await withTenantQuery(`
    UPDATE assets SET assigned_to = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND tenant_id = $3 RETURNING *;
  `, [cleanTargetId, assetId, tenantId], tenantId);

  return { success: true, assignment_id: assignmentId, asset: updatedAsset[0] };
}

export async function returnAsset(tenantId: string, assetId: string) {
  const assetRes = await withTenantQuery('SELECT assigned_to FROM assets WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [assetId, tenantId], tenantId);
  const asset = assetRes[0];

  if (!asset) throw new AppError('Asset not found', ErrorCode.NOT_FOUND);
  if (!asset.assigned_to) throw new AppError('Asset is not currently assigned', ErrorCode.BAD_REQUEST);

  // Close the active assignment record
  await withTenantQuery(`
    UPDATE asset_assignments SET returned_at = CURRENT_TIMESTAMP 
    WHERE asset_id = $1 AND tenant_id = $2 AND returned_at IS NULL;
  `, [assetId, tenantId], tenantId);

  // Release the asset lock
  const updatedAsset = await withTenantQuery(`
    UPDATE assets SET assigned_to = NULL, updated_at = CURRENT_TIMESTAMP 
    WHERE id = $1 AND tenant_id = $2 RETURNING *;
  `, [assetId, tenantId], tenantId);

  return { success: true, asset: updatedAsset[0] };
}

export async function disposeAsset(tenantId: string, assetId: string, reason: string, adminId: string) {
  const cfg = loadConfig();
  if (!cfg.tiers.disposalWorkflow) throw new AppError('Disposal workflow disabled', ErrorCode.FORBIDDEN);

  const cleanAdminId = parseUserId(adminId);

  // Ensure asset exists and is not currently assigned
  const assetRes = await withTenantQuery('SELECT status, assigned_to FROM assets WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [assetId, tenantId], tenantId);
  const asset = assetRes[0];

  if (!asset) throw new AppError('Asset not found', ErrorCode.NOT_FOUND);
  if (asset.assigned_to) throw new AppError('Cannot dispose an actively assigned asset. Return it first.', ErrorCode.BAD_REQUEST);
  if (asset.status === 'disposed') throw new AppError('Asset already disposed', ErrorCode.BAD_REQUEST);

  const disposalId = crypto.randomUUID();
  await withTenantQuery(`
    INSERT INTO asset_disposals (id, tenant_id, asset_id, disposal_reason, approved_by)
    VALUES ($1, $2, $3, $4, $5);
  `, [disposalId, tenantId, assetId, reason, cleanAdminId], tenantId);

  const updatedAsset = await withTenantQuery(`
    UPDATE assets SET status = 'disposed', updated_at = CURRENT_TIMESTAMP 
    WHERE id = $1 AND tenant_id = $2 RETURNING *;
  `, [assetId, tenantId], tenantId);

  return { success: true, disposal_id: disposalId, asset: updatedAsset[0] };
}
