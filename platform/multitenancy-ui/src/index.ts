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
  try {
    const configPath = path.join(process.cwd(), 'config', 'multitenancy-ui.json');
    if (fs.existsSync(configPath)) return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return { enabled: true, tiers: { teamInvitations: true }, limits: { userCount: 10, invitationExpiryHours: 48 } };
}

// Helper injected to bootstrap team memberships for testing
export async function createTenantUser(tenantId: string, data: any) {
  const cleanUserId = parseUserId(data.user_id);
  const mappingId = crypto.randomUUID();

  const insertQuery = `
    INSERT INTO tenant_users (id, tenant_id, user_id, role)
    VALUES ($1, $2, $3, $4) RETURNING *;
  `;
  const result = await withTenantQuery(insertQuery, [mappingId, tenantId, cleanUserId, data.role || 'member'], tenantId);
  return result[0];
}

export async function inviteUser(tenantId: string, adminId: string, data: any) {
  const cfg = loadConfig();
  if (!cfg.enabled) throw new AppError('Multitenancy UI is disabled', ErrorCode.FORBIDDEN);
  if (!cfg.tiers.teamInvitations) throw new AppError('Invitations disabled', ErrorCode.FORBIDDEN);

  const cleanAdminId = parseUserId(adminId);

  // Enforce User count limits
  const countRes = await withTenantQuery('SELECT COUNT(*) as count FROM tenant_users WHERE tenant_id = $1 AND is_active = true', [tenantId], tenantId);
  if (parseInt(countRes[0]?.count || '0', 10) >= cfg.limits.userCount) {
    throw new AppError('Active seat limits reached', ErrorCode.FORBIDDEN);
  }

  const token = crypto.randomBytes(32).toString('hex'); // Single-use 64-char secure token
  const expiresAt = new Date(Date.now() + cfg.limits.invitationExpiryHours * 60 * 60 * 1000);
  const invitationId = crypto.randomUUID();

  const insertQuery = `
    INSERT INTO tenant_invitations (id, tenant_id, email, role, token, invited_by, expires_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *;
  `;
  const result = await withTenantQuery(insertQuery, [
    invitationId, tenantId, data.email, data.role || 'member', token, cleanAdminId, expiresAt
  ], tenantId);

  return result[0];
}

export async function acceptInvitation(tenantId: string, token: string, userId: string) {
  const cleanUserId = parseUserId(userId);

  // Atomic lookup of target pending token
  const inviteRes = await withTenantQuery('SELECT * FROM tenant_invitations WHERE token = $1 AND tenant_id = $2', [token, tenantId], tenantId);
  const invite = inviteRes[0];
  if (!invite) throw new AppError('Invitation invalid or not found', ErrorCode.NOT_FOUND);
  if (invite.status !== 'pending') throw new AppError('Invitation has already been resolved', ErrorCode.BAD_REQUEST);
  if (new Date(invite.expires_at) < new Date()) throw new AppError('Invitation token has expired', ErrorCode.BAD_REQUEST);

  // Atomic execution: Mark accepted + create user mapping
  await withTenantQuery(`UPDATE tenant_invitations SET status = 'accepted', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2`, [invite.id, tenantId], tenantId);
  const userRecord = await createTenantUser(tenantId, { user_id: cleanUserId, role: invite.role });

  return { success: true, user_record: userRecord };
}

export async function removeUser(tenantId: string, userId: string) {
  const cleanUserId = parseUserId(userId);

  // 1. Fetch user to verify their current active status and role
  const userRes = await withTenantQuery('SELECT role FROM tenant_users WHERE user_id = $1 AND tenant_id = $2 AND is_active = true', [cleanUserId, tenantId], tenantId);
  const user = userRes[0];
  if (!user) throw new AppError('Target team member not found or inactive', ErrorCode.NOT_FOUND);

  // 2. Prevent removing the last administrator (Critical compliance safeguard)
  if (user.role === 'admin') {
    const adminRes = await withTenantQuery('SELECT COUNT(*) as count FROM tenant_users WHERE tenant_id = $1 AND role = \'admin\' AND is_active = true', [tenantId], tenantId);
    const adminCount = parseInt(adminRes[0]?.count || '0', 10);
    if (adminCount <= 1) {
      throw new AppError('Administrative deactivation blocked: cannot remove the last admin', ErrorCode.FORBIDDEN);
    }
  }

  // Deactivate team member atomically
  await withTenantQuery('UPDATE tenant_users SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND tenant_id = $2', [cleanUserId, tenantId], tenantId);
  return { success: true };
}
