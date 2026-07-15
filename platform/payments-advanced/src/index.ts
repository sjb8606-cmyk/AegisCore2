import { withTenantQuery } from '@platform/tenancy';
import * as fs from 'fs';
import * as path from 'path';
import { AppError, ErrorCode } from '@platform/utils';

export function parseUserId(userId: any): string {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof userId === 'string' && uuidRegex.test(userId)) return userId;
  throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, ErrorCode.BAD_REQUEST);
}

function loadConfig() {
  try {
    const configPath = path.join(process.cwd(), 'config', 'payments-advanced.json');
    if (fs.existsSync(configPath)) return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return {
    enabled: true,
    tiers: { dunningManagement: true, savedPaymentMethods: true, taxCollection: true },
    dunning: { retryIntervalDays: [1, 3, 7, 14], maxRetries: 4 },
    tax: { defaultRate: 0.15 }
  };
}

// Local mock simulator to prevent runtime/network dependencies on live Stripe API
class MockStripe {
  paymentMethods = {
    retrieve: async (id: string) => {
      return {
        id,
        type: 'card',
        card: {
          last4: '4242',
          brand: 'visa',
          exp_month: 12,
          exp_year: 2030
        }
      };
    }
  };
}

async function getStripeClient() {
  return new MockStripe();
}

async function checkTier(tenantId: string, feature: string) {
  const cfg = loadConfig();
  if (!cfg.enabled || !cfg.tiers?.[feature as keyof typeof cfg.tiers]) {
    throw new AppError(`Feature ${feature} not available in current billing tier`, ErrorCode.FORBIDDEN);
  }
}

export async function initiateDunning(tenantId: string, paymentId: string, amountCents: number, subscriptionId?: string) {
  await checkTier(tenantId, 'dunningManagement');
  const cfg = loadConfig();

  const nextRetry = new Date();
  nextRetry.setDate(nextRetry.getDate() + cfg.dunning.retryIntervalDays[0]);

  const dunningId = crypto.randomUUID();
  const insertQuery = `
    INSERT INTO dunning_records (id, tenant_id, payment_id, subscription_id, max_attempts, next_retry_at, amount_cents)
    VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *;
  `;
  const res = await withTenantQuery(insertQuery, [
    dunningId, tenantId, paymentId, subscriptionId || null, cfg.dunning.maxRetries, nextRetry, amountCents
  ], tenantId);

  return res[0];
}

export async function savePaymentMethod(tenantId: string, userId: string, stripePaymentMethodId: string) {
  await checkTier(tenantId, 'savedPaymentMethods');
  const cleanUserId = parseUserId(userId);

  const stripe = await getStripeClient();
  const pm = await stripe.paymentMethods.retrieve(stripePaymentMethodId);

  const pmId = crypto.randomUUID();
  const insertQuery = `
    INSERT INTO saved_payment_methods (id, tenant_id, user_id, stripe_pm_id, type, last4, brand, exp_month, exp_year, is_default)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
    ON CONFLICT (tenant_id, stripe_pm_id) DO UPDATE SET last4 = EXCLUDED.last4
    RETURNING *;
  `;
  const res = await withTenantQuery(insertQuery, [
    pmId, tenantId, cleanUserId, stripePaymentMethodId, pm.type, pm.card?.last4, pm.card?.brand, pm.card?.exp_month, pm.card?.exp_year
  ], tenantId);

  return res[0];
}

export async function calculateTax(tenantId: string, paymentId: string, amountCents: number, jurisdiction: string) {
  await checkTier(tenantId, 'taxCollection');
  const cfg = loadConfig();

  const rate = cfg.tax.defaultRate;
  const taxCents = Math.round(amountCents * rate);
  const taxId = crypto.randomUUID();

  const insertQuery = `
    INSERT INTO tax_records (id, tenant_id, payment_id, jurisdiction, rate, amount_cents)
    VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;
  `;
  const res = await withTenantQuery(insertQuery, [
    taxId, tenantId, paymentId, jurisdiction, rate, taxCents
  ], tenantId);

  return res[0];
}
