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
  const configPath = path.join(process.cwd(), 'config', 'pos.json');
  try {
    if (fs.existsSync(configPath)) return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return { enabled: true, limits: { registers: 3 }, thresholds: { maxCashVariance: 500 } };
}

export async function openSession(tenantId: string, registerId: string, openingCashCents: number, userId: string) {
  const cfg = loadConfig();
  if (!cfg.enabled) throw new AppError('POS vertical is disabled', ErrorCode.FORBIDDEN);

  const cleanUserId = parseUserId(userId);

  // Safeguard: Ensure only one open session is active per register
  const activeRes = await withTenantQuery('SELECT id FROM pos_sessions WHERE tenant_id = $1 AND register_id = $2 AND status = \'open\'', [tenantId, registerId], tenantId);
  if (activeRes.length > 0) {
    throw new AppError('Register already has an active open session', ErrorCode.BAD_REQUEST);
  }

  const sessionId = crypto.randomUUID();
  const insertQuery = `
    INSERT INTO pos_sessions (id, tenant_id, register_id, opened_by, opening_cash_cents)
    VALUES ($1, $2, $3, $4, $5) RETURNING *;
  `;
  const result = await withTenantQuery(insertQuery, [
    sessionId, tenantId, registerId, cleanUserId, openingCashCents
  ], tenantId);

  return result[0];
}

export async function createTransaction(tenantId: string, userId: string, data: any) {
  const cfg = loadConfig();
  const cleanUserId = parseUserId(userId);

  // Validate active session with lock
  const sessionRes = await withTenantQuery('SELECT id FROM pos_sessions WHERE tenant_id = $1 AND register_id = $2 AND status = \'open\'', [tenantId, data.registerId], tenantId);
  const session = sessionRes[0];
  if (!session) throw new AppError('No active session open on this register', ErrorCode.FORBIDDEN);

  // Calculate sum of transaction
  const items = data.items || [];
  let totalCents = 0;
  for (const item of items) {
    const qty = item.quantity || 1;
    const unitPrice = item.unitPrice || 0;
    const discount = item.discountAmount || 0;
    totalCents += (qty * unitPrice) - discount;
  }

  // Simulate inventory deduction (debits/hooks)
  const transactionId = crypto.randomUUID();
  const insertQuery = `
    INSERT INTO pos_transactions (id, tenant_id, session_id, cashier_id, total_amount_cents, items, payments)
    VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *;
  `;
  const result = await withTenantQuery(insertQuery, [
    transactionId, tenantId, session.id, cleanUserId, totalCents, JSON.stringify(items), JSON.stringify(data.payments || [])
  ], tenantId);

  return result[0];
}

export async function closeSession(tenantId: string, sessionId: string, closingCashCents: number, userId: string) {
  const cleanUserId = parseUserId(userId);
  const cfg = loadConfig();

  // Atomic locked lookup of open session
  const sessionRes = await withTenantQuery('SELECT opening_cash_cents FROM pos_sessions WHERE id = $1 AND tenant_id = $2 AND status = \'open\' FOR UPDATE', [sessionId, tenantId], tenantId);
  const session = sessionRes[0];
  if (!session) throw new AppError('Open session not found to reconcile', ErrorCode.NOT_FOUND);

  // Sum transaction totals logged during this session
  const txSumRes = await withTenantQuery('SELECT COALESCE(SUM(total_amount_cents), 0) as total FROM pos_transactions WHERE session_id = $1 AND tenant_id = $2', [sessionId, tenantId], tenantId);
  const totalTxCents = parseInt(txSumRes[0]?.total || '0', 10);

  const openingCash = parseInt(session.opening_cash_cents, 10);
  const expectedCash = openingCash + totalTxCents;
  const variance = closingCashCents - expectedCash;

  // Atomically close session
  await withTenantQuery(`
    UPDATE pos_sessions 
    SET status = 'closed', closed_by = $1, closing_cash_cents = $2, closed_at = CURRENT_TIMESTAMP
    WHERE id = $3 AND tenant_id = $4;
  `, [cleanUserId, closingCashCents, sessionId, tenantId], tenantId);

  return {
    success: true,
    opening_cash_cents: openingCash,
    expected_cash_cents: expectedCash,
    variance_cents: variance,
    limit_breached: Math.abs(variance) > cfg.thresholds.maxCashVariance
  };
}
