import { withTenantQuery } from '@platform/tenancy';
import * as fs from 'fs';
import * as path from 'path';
import { AppError, ErrorCode, parseUserId } from '@platform/utils';
export { AppError, ErrorCode };

function loadConfig() {
  const configPath = path.join(process.cwd(), 'config', 'loyalty.json');
  try {
    if (fs.existsSync(configPath)) return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return { enabled: true, tiers: { rewardCatalog: true }, limits: { memberCount: 5000, pointExpiryDays: 365 } };
}

// Immutable Local NanoID Generator Simulator
export function generateNanoId(size: number = 8): string {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let id = '';
  for (let i = 0; i < size; i++) {
    id += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return id;
}

export async function enrollMember(tenantId: string, data: any) {
  const cfg = loadConfig();
  if (!cfg.enabled) throw new AppError('Loyalty features are disabled', ErrorCode.FORBIDDEN);

  const countRes = await withTenantQuery('SELECT COUNT(*) as count FROM loyalty_members WHERE tenant_id = $1 AND deleted_at IS NULL', [tenantId], tenantId);
  if (parseInt(countRes[0]?.count || '0', 10) >= cfg.limits.memberCount) {
    throw new AppError('Member limits reached for current tier', ErrorCode.FORBIDDEN);
  }

  const referralCode = generateNanoId(8);
  const memberId = crypto.randomUUID();

  const insertQuery = `
    INSERT INTO loyalty_members (id, tenant_id, email, name, referral_code)
    VALUES ($1, $2, $3, $4, $5) RETURNING *;
  `;
  const res = await withTenantQuery(insertQuery, [
    memberId, tenantId, data.email, data.name || null, referralCode
  ], tenantId);

  return res[0];
}

// Injected helper to easily provision rewards during testing
export async function createReward(tenantId: string, data: any) {
  const rewardId = crypto.randomUUID();
  const insertQuery = `
    INSERT INTO rewards (id, tenant_id, name, description, points_cost, type, stock, is_active)
    VALUES ($1, $2, $3, $4, $5, $6, $7, true) RETURNING *;
  `;
  const res = await withTenantQuery(insertQuery, [
    rewardId, tenantId, data.name, data.description || null, data.points_cost, data.type || 'discount', data.stock || null
  ], tenantId);
  return res[0];
}

export async function awardPoints(tenantId: string, memberId: string, points: number, description: string) {
  if (points <= 0) throw new AppError('Awarded points value must be positive', ErrorCode.BAD_REQUEST);
  const cfg = loadConfig();

  // Atomic row lock via direct arrays
  const memberRes = await withTenantQuery('SELECT points_balance FROM loyalty_members WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [memberId, tenantId], tenantId);
  const member = memberRes[0];
  if (!member) throw new AppError('Member not found', ErrorCode.NOT_FOUND);

  const currentBalance = parseInt(member.points_balance, 10);
  const newBalance = currentBalance + points;

  const txId = crypto.randomUUID();
  const insertTx = `
    INSERT INTO points_transactions (id, tenant_id, member_id, type, points, balance_after, description, expires_at)
    VALUES ($1, $2, $3, 'earn', $4, $5, $6, CURRENT_TIMESTAMP + INTERVAL '1 day' * $7) RETURNING *;
  `;
  const tx = await withTenantQuery(insertTx, [
    txId, tenantId, memberId, points, newBalance, description, cfg.limits.pointExpiryDays
  ], tenantId);

  await withTenantQuery('UPDATE loyalty_members SET points_balance = $1, lifetime_points = lifetime_points + $2, last_activity = CURRENT_TIMESTAMP WHERE id = $3 AND tenant_id = $4', [newBalance, points, memberId, tenantId], tenantId);

  return tx[0];
}

export async function redeemReward(tenantId: string, memberId: string, rewardId: string) {
  const cfg = loadConfig();
  if (!cfg.tiers.rewardCatalog) throw new AppError('Reward Catalog disabled', ErrorCode.FORBIDDEN);

  // Double row locks to prevent atomic balance race conditions
  const memberRes = await withTenantQuery('SELECT points_balance FROM loyalty_members WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [memberId, tenantId], tenantId);
  const rewardRes = await withTenantQuery('SELECT points_cost, stock, is_active, name FROM rewards WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [rewardId, tenantId], tenantId);

  const member = memberRes[0];
  const reward = rewardRes[0];

  if (!member) throw new AppError('Member not found', ErrorCode.NOT_FOUND);
  if (!reward || !reward.is_active) throw new AppError('Reward not active or not found', ErrorCode.NOT_FOUND);
  if (reward.stock !== null && reward.stock <= 0) throw new AppError('Reward is out of stock', ErrorCode.FORBIDDEN);

  const pointsCost = parseInt(reward.points_cost, 10);
  const currentBalance = parseInt(member.points_balance, 10);

  if (currentBalance < pointsCost) {
    throw new AppError('Insufficient points balance for this redemption', ErrorCode.FORBIDDEN);
  }

  const newBalance = currentBalance - pointsCost;
  const redemptionId = crypto.randomUUID();
  const redemptionCode = `REDEEM-${generateNanoId(12)}`;

  const res = await withTenantQuery(`
    INSERT INTO reward_redemptions (id, tenant_id, member_id, reward_id, points_used, code, status)
    VALUES ($1, $2, $3, $4, $5, $6, 'fulfilled') RETURNING *;
  `, [redemptionId, tenantId, memberId, rewardId, pointsCost, redemptionCode], tenantId);

  const txId = crypto.randomUUID();
  await withTenantQuery(`
    INSERT INTO points_transactions (id, tenant_id, member_id, type, points, balance_after, description, reference)
    VALUES ($1, $2, $3, 'redeem', $4, $5, $6, $7);
  `, [txId, tenantId, memberId, -pointsCost, newBalance, `Redeemed: ${reward.name}`, redemptionId], tenantId);

  await withTenantQuery('UPDATE loyalty_members SET points_balance = $1 WHERE id = $2 AND tenant_id = $3', [newBalance, memberId, tenantId], tenantId);

  if (reward.stock !== null) {
    await withTenantQuery('UPDATE rewards SET stock = stock - 1 WHERE id = $1 AND tenant_id = $2', [rewardId, tenantId], tenantId);
  }

  return res[0];
}
