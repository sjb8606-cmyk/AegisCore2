import { withTenantQuery } from '@platform/tenancy';
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

export function isValidUuid(id: any): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return typeof id === 'string' && uuidRegex.test(id);
}

export function parseUserId(userId: any): string {
  if (isValidUuid(userId)) return userId;
  throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, 'BAD_REQUEST');
}

function loadConfig() {
  const configPath = path.join(process.cwd(), 'config', 'subscriptions-advanced.json');
  try {
    if (fs.existsSync(configPath)) return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return { enabled: true, tiers: { usageMetering: true, featureEntitlements: true } };
}

export async function createPlan(tenantId: string, data: any) {
  const cfg = loadConfig();
  if (!cfg.enabled) throw new AppError('Subscriptions disabled', 'FORBIDDEN');

  const planId = crypto.randomUUID();
  const res = await withTenantQuery(`
    INSERT INTO saas_plans (id, tenant_id, name, price_cents, interval)
    VALUES ($1, $2, $3, $4, $5) RETURNING *;
  `, [planId, tenantId, data.name, data.price_cents || 0, data.interval || 'month'], tenantId);

  const plan = res[0];

  if (data.entitlements && Array.isArray(data.entitlements)) {
    for (const ent of data.entitlements) {
      await withTenantQuery(`
        INSERT INTO saas_entitlements (id, tenant_id, plan_id, metric, limit_quantity)
        VALUES ($1, $2, $3, $4, $5);
      `, [crypto.randomUUID(), tenantId, planId, ent.metric, ent.limit_quantity], tenantId);
    }
  }

  return plan;
}

export async function createSubscription(tenantId: string, userId: string, planId: string) {
  if (!isValidUuid(planId)) {
    throw new AppError('Invalid Plan ID format. Must be a valid UUID.', 'BAD_REQUEST');
  }

  const cleanUserId = parseUserId(userId);
  const subId = crypto.randomUUID();
  
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + 30);

  const res = await withTenantQuery(`
    INSERT INTO saas_subscriptions (id, tenant_id, plan_id, user_id, status, current_period_end)
    VALUES ($1, $2, $3, $4, 'active', $5) RETURNING *;
  `, [subId, tenantId, planId, cleanUserId, endDate.toISOString()], tenantId);

  return res[0];
}

export async function recordUsage(tenantId: string, subscriptionId: string, data: any, userId: string) {
  if (!isValidUuid(subscriptionId)) {
    throw new AppError('Invalid Subscription ID format. Must be a valid UUID.', 'BAD_REQUEST');
  }

  const cfg = loadConfig();
  const cleanUserId = parseUserId(userId);
  
  if (cfg.tiers.featureEntitlements) {
    const status = await getEntitlementStatus(tenantId, subscriptionId, data.metric);
    if (status && status.remaining < data.quantity) {
      throw new AppError(`Overage blocked. Metric: ${data.metric} | Remaining: ${status.remaining} | Attempted: ${data.quantity}`, 'PAYMENT_REQUIRED');
    }
  }

  const recordId = crypto.randomUUID();
  const res = await withTenantQuery(`
    INSERT INTO saas_usage_records (id, tenant_id, subscription_id, metric, quantity, created_by)
    VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;
  `, [recordId, tenantId, subscriptionId, data.metric, data.quantity, cleanUserId], tenantId);

  return res[0];
}

export async function getEntitlementStatus(tenantId: string, subscriptionId: string, metric: string) {
  if (!isValidUuid(subscriptionId)) {
    throw new AppError('Invalid Subscription ID format. Must be a valid UUID.', 'BAD_REQUEST');
  }

  const limitRes = await withTenantQuery(`
    SELECT e.limit_quantity, s.current_period_start, s.current_period_end
    FROM saas_subscriptions s
    JOIN saas_entitlements e ON s.plan_id = e.plan_id
    WHERE s.id = $1 AND s.tenant_id = $2 AND e.metric = $3
  `, [subscriptionId, tenantId, metric], tenantId);

  if (!limitRes || limitRes.length === 0) {
    return { metric, limit: 0, used: 0, remaining: 0, allowed: false };
  }

  const { limit_quantity, current_period_start, current_period_end } = limitRes[0];

  const usageRes = await withTenantQuery(`
    SELECT COALESCE(SUM(quantity), 0) as total_used
    FROM saas_usage_records
    WHERE subscription_id = $1 AND tenant_id = $2 AND metric = $3
      AND incurred_at >= $4 AND incurred_at <= $5
  `, [subscriptionId, tenantId, metric, current_period_start, current_period_end], tenantId);

  const used = parseInt(usageRes[0]?.total_used || '0', 10);
  const limit = parseInt(limit_quantity, 10);
  const remaining = Math.max(0, limit - used);

  return {
    metric,
    limit,
    used,
    remaining,
    allowed: remaining > 0
  };
}
