import { withTenantQuery } from '@platform/tenancy';
import { AppError, ErrorCode, parseUserId, isValidUuid } from '@platform/utils';
export { AppError, ErrorCode };
import { z } from 'zod';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export const PriceComputationSchema = z.object({
  entity_id: z.string().uuid(),
  base_price: z.number().nonnegative(),
  demand_factor: z.number().default(1.0),
  competitor_price: z.number().optional(),
});

export type PricingRule = {
  id: string;
  rule_type: string;
  config: Record<string, any>;
  active: boolean;
};

function loadConfig() {
  const configPath = path.join(process.cwd(), 'config', 'ai-pricing.json');
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return { enabled: true, tiers: { basicPricingRules: true, aBTesting: true }, thresholds: { minMargin: 0.15 } };
}

export async function createRule(tenantId: string, data: any) {
  const cfg = loadConfig();
  if (!cfg.enabled || !cfg.tiers.basicPricingRules) {
    throw new AppError('AI Pricing basic rules engine tier is disabled', 'FORBIDDEN');
  }

  const ruleId = crypto.randomUUID();
  const res = await withTenantQuery(`
    INSERT INTO pricing_rules (id, tenant_id, entity_type, entity_id, rule_type, config, priority)
    VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *;
  `, [ruleId, tenantId, data.entity_type, data.entity_id || null, data.rule_type, JSON.stringify(data.config), data.priority || 0], tenantId);

  return res[0];
}

export async function computePrice(tenantId: string, data: any) {
  const cfg = loadConfig();
  if (!cfg.enabled || !cfg.tiers.basicPricingRules) {
    throw new AppError('AI Pricing basic rules engine tier is disabled', 'FORBIDDEN');
  }

  const input = PriceComputationSchema.parse(data);

  // Retrieve active rules sorted chronologically by execution priority
  const rules = await withTenantQuery(`
    SELECT * FROM pricing_rules WHERE tenant_id = $1 AND active = true ORDER BY priority DESC;
  `, [tenantId], tenantId);

  let finalPrice = input.base_price;

  // Apply surge pricing logic
  for (const rule of rules) {
    const config = typeof rule.config === 'string' ? JSON.parse(rule.config) : rule.config;
    
    if (rule.rule_type === 'surge' && input.demand_factor > 1.5) {
      const multiplier = parseFloat(config.multiplier || '1.30');
      finalPrice *= multiplier;
    }
  }

  // Enforce Hard Financial price floors (non-bypassable)
  const minPrice = input.base_price * (cfg.thresholds?.minMargin || 0.15);
  if (finalPrice < minPrice) {
    finalPrice = minPrice;
  }

  if (finalPrice < 0) {
    throw new AppError('Financial Safety Block: Negative pricing execution prevented.', 'BAD_REQUEST');
  }

  const historyId = crypto.randomUUID();
  // Record changes to audit log
  await withTenantQuery(`
    INSERT INTO pricing_history (id, tenant_id, entity_id, old_price, new_price, reason, model_version)
    VALUES ($1, $2, $3, $4, $5, 'ai_computation', 'pricing-engine-v1.0');
  `, [historyId, tenantId, input.entity_id, input.base_price, finalPrice], tenantId);

  return {
    entity_id: input.entity_id,
    original_price: input.base_price,
    computed_price: Math.round(finalPrice * 100) / 100,
    floor_applied: finalPrice === minPrice
  };
}

export async function runABTest(tenantId: string, data: any) {
  const cfg = loadConfig();
  if (!cfg.enabled || !cfg.tiers.aBTesting) {
    throw new AppError('AI Pricing A/B testing experiment tier is disabled', 'FORBIDDEN');
  }

  const experimentId = crypto.randomUUID();
  const res = await withTenantQuery(`
    INSERT INTO pricing_experiments (id, tenant_id, name, hypothesis, variants)
    VALUES ($1, $2, $3, $4, $5) RETURNING *;
  `, [experimentId, tenantId, data.name, data.hypothesis || null, JSON.stringify(data.variants)], tenantId);

  return res[0];
}

export async function getPricingLedger(tenantId: string, entityId: string) {
  if (!isValidUuid(entityId)) throw new AppError('Invalid Entity ID format.', 'BAD_REQUEST');

  const history = await withTenantQuery(`
    SELECT * FROM pricing_history WHERE entity_id = $1 AND tenant_id = $2 ORDER BY created_at DESC;
  `, [entityId, tenantId], tenantId);

  const activeRules = await withTenantQuery(`
    SELECT * FROM pricing_rules WHERE entity_id = $1 AND tenant_id = $2 AND active = true;
  `, [entityId, tenantId], tenantId);

  return {
    entity_id: entityId,
    active_rules: activeRules,
    history
  };
}
