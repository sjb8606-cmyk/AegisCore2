import { withTenantQuery } from '@platform/tenancy';
import { z } from 'zod';
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

export interface PaymentDriver {
  readonly providerId: string;
  createIntent(params: any): Promise<any>;
  confirmIntent(intentId: string, params: any): Promise<any>;
  cancelIntent(intentId: string): Promise<any>;
  refund(params: any): Promise<any>;
}

export const CreateIntentSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().default('USD'),
  idempotency_key: z.string().min(1),
  customer_ref: z.string().uuid().optional(),
  payment_method_ref: z.string().uuid().optional(),
});

export const RegisterMethodSchema = z.object({
  customer_ref: z.string().uuid(),
  provider: z.enum(['paypal', 'stripe', 'crypto']),
  token: z.string().min(1),
  last_four: z.string().length(4),
  brand: z.string().min(1),
});

export const ProcessRefundSchema = z.object({
  intent_id: z.string().uuid(),
  amount: z.number().positive(),
  reason: z.string().optional().default('customer_request'),
});

export function isValidUuid(id: any): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return typeof id === 'string' && uuidRegex.test(id);
}

export function parseUserId(userId: any): string {
  if (isValidUuid(userId)) return userId;
  throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, 'BAD_REQUEST');
}

function loadConfig() {
  try {
    const configPath = path.join(process.cwd(), 'config', 'payments.json');
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return { enabled: true, tiers: { paymentIntents: true, refunds: true, auditTrail: true } };
}

// Swappable Driver Architect Implementations
export class PayPalDriver implements PaymentDriver {
  readonly providerId = 'paypal';
  async createIntent(params: any) {
    return { provider_intent_id: `PAYPAL-INT-${crypto.randomBytes(8).toString('hex')}`, status: 'pending' };
  }
  async confirmIntent(intentId: string, params: any) {
    return { status: 'succeeded' };
  }
  async cancelIntent(intentId: string) {
    return { status: 'canceled' };
  }
  async refund(params: any) {
    return { provider_refund_id: `PAYPAL-REF-${crypto.randomBytes(8).toString('hex')}`, status: 'succeeded' };
  }
}

export class StripeDriver implements PaymentDriver {
  readonly providerId = 'stripe';
  async createIntent(params: any) {
    return { provider_intent_id: `STRIPE-INT-${crypto.randomBytes(8).toString('hex')}`, status: 'pending' };
  }
  async confirmIntent(intentId: string, params: any) {
    return { status: 'succeeded' };
  }
  async cancelIntent(intentId: string) {
    return { status: 'canceled' };
  }
  async refund(params: any) {
    return { provider_refund_id: `STRIPE-REF-${crypto.randomBytes(8).toString('hex')}`, status: 'succeeded' };
  }
}

export class CryptoDriver implements PaymentDriver {
  readonly providerId = 'crypto';
  async createIntent(params: any) {
    return { provider_intent_id: `CRYPTO-TX-${crypto.randomBytes(16).toString('hex')}`, status: 'pending' };
  }
  async confirmIntent(intentId: string, params: any) {
    return { status: 'succeeded' };
  }
  async cancelIntent(intentId: string) {
    return { status: 'canceled' };
  }
  async refund(params: any) {
    return { provider_refund_id: `CRYPTO-REF-${crypto.randomBytes(16).toString('hex')}`, status: 'succeeded' };
  }
}

// Driver Registry Resolver
export class PaymentDriverRegistry {
  private static drivers = new Map<string, PaymentDriver>();
  static register(driver: PaymentDriver) {
    this.drivers.set(driver.providerId, driver);
  }
  static resolve(provider: string): PaymentDriver {
    const driver = this.drivers.get(provider);
    if (!driver) throw new AppError(`Unsupported payment provider driver: '${provider}'`, 'BAD_REQUEST');
    return driver;
  }
}

// Register Active drivers at boot
PaymentDriverRegistry.register(new PayPalDriver());
PaymentDriverRegistry.register(new StripeDriver());
PaymentDriverRegistry.register(new CryptoDriver());

export async function resolveDriver(tenantId: string): Promise<PaymentDriver> {
  const activeProvider = 'paypal'; 
  return PaymentDriverRegistry.resolve(activeProvider);
}

export async function createPaymentIntent(tenantId: string, data: any) {
  const cfg = loadConfig();
  if (!cfg.enabled) throw new AppError('Payments engine is disabled', 'FORBIDDEN');

  const parsed = CreateIntentSchema.parse(data);

  const existing = await withTenantQuery(`
    SELECT * FROM payment_intents WHERE idempotency_key = $1 AND tenant_id = $2;
  `, [parsed.idempotency_key, tenantId], tenantId);

  if (existing && existing.length > 0) {
    return existing[0];
  }

  const driver = await resolveDriver(tenantId);
  const intentId = crypto.randomUUID();

  const providerRes = await driver.createIntent({ amount: parsed.amount });
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + 60);

  const res = await withTenantQuery(`
    INSERT INTO payment_intents (id, tenant_id, provider, provider_intent_id, idempotency_key, amount, currency, status, payment_method_ref, customer_ref, expires_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *;
  `, [intentId, tenantId, driver.providerId, providerRes.provider_intent_id, parsed.idempotency_key, parsed.amount, parsed.currency, providerRes.status, parsed.payment_method_ref || null, parsed.customer_ref || null, expiresAt.toISOString()], tenantId);

  return res[0];
}

export async function confirmPaymentIntent(tenantId: string, intentId: string) {
  if (!isValidUuid(intentId)) throw new AppError('Invalid Intent ID format.', 'BAD_REQUEST');

  const intentRes = await withTenantQuery(`
    SELECT * FROM payment_intents WHERE id = $1 AND tenant_id = $2;
  `, [intentId, tenantId], tenantId);
  const intent = intentRes[0];
  if (!intent) throw new AppError('Payment intent not found.', 'NOT_FOUND');

  const driver = await resolveDriver(tenantId);
  const confirmRes = await driver.confirmIntent(intent.provider_intent_id, {});

  // Removed non-existent updated_at column update
  const res = await withTenantQuery(`
    UPDATE payment_intents SET status = $1 WHERE id = $2 AND tenant_id = $3 RETURNING *;
  `, [confirmRes.status, intentId, tenantId], tenantId);

  return res[0];
}

export async function cancelPaymentIntent(tenantId: string, intentId: string) {
  if (!isValidUuid(intentId)) throw new AppError('Invalid Intent ID format.', 'BAD_REQUEST');

  const intentRes = await withTenantQuery(`
    SELECT * FROM payment_intents WHERE id = $1 AND tenant_id = $2;
  `, [intentId, tenantId], tenantId);
  const intent = intentRes[0];
  if (!intent) throw new AppError('Payment intent not found.', 'NOT_FOUND');

  const driver = await resolveDriver(tenantId);
  await driver.cancelIntent(intent.provider_intent_id);

  // Removed non-existent updated_at column update
  const res = await withTenantQuery(`
    UPDATE payment_intents SET status = 'canceled' WHERE id = $1 AND tenant_id = $2 RETURNING *;
  `, [intentId, tenantId], tenantId);

  return res[0];
}

export async function attachPaymentMethod(tenantId: string, data: any) {
  const parsed = RegisterMethodSchema.parse(data);
  const methodId = crypto.randomUUID();

  const res = await withTenantQuery(`
    INSERT INTO payment_methods (id, tenant_id, customer_ref, provider, provider_method_id, type, last_four, brand, expires_month, expires_year)
    VALUES ($1, $2, $3, $4, $5, 'card', $6, $7, 12, 2030) RETURNING *;
  `, [methodId, tenantId, parsed.customer_ref, parsed.provider, parsed.token, parsed.last_four, parsed.brand], tenantId);

  return res[0];
}

export async function issueRefund(tenantId: string, data: any) {
  const parsed = ProcessRefundSchema.parse(data);

  const intentRes = await withTenantQuery(`
    SELECT * FROM payment_intents WHERE id = $1 AND tenant_id = $2;
  `, [parsed.intent_id, tenantId], tenantId);
  const intent = intentRes[0];
  if (!intent) throw new AppError('Payment intent not found.', 'NOT_FOUND');
  if (intent.status !== 'succeeded') throw new AppError('Cannot refund an un-captured or failed payment.', 'BAD_REQUEST');

  const refundTotalsRes = await withTenantQuery(`
    SELECT COALESCE(SUM(amount), 0) as total_refunded 
    FROM payment_refunds 
    WHERE intent_id = $1 AND tenant_id = $2 AND status = 'succeeded';
  `, [parsed.intent_id, tenantId], tenantId);
  
  const currentRefunded = parseFloat(refundTotalsRes[0]?.total_refunded || '0');
  const allowedLimit = parseFloat(intent.amount);

  if ((currentRefunded + parsed.amount) > allowedLimit) {
    throw new AppError(`Sovereign Financial Block: Refund exceeds absolute limit value. Cap: ${allowedLimit} | Refunded: ${currentRefunded} | Requested: ${parsed.amount}`, 'BAD_REQUEST');
  }

  const driver = await resolveDriver(tenantId);
  const refundRes = await driver.refund({ amount: parsed.amount });

  const refundId = crypto.randomUUID();
  const res = await withTenantQuery(`
    INSERT INTO payment_refunds (id, tenant_id, intent_id, provider_refund_id, amount, status, reason)
    VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *;
  `, [refundId, tenantId, parsed.intent_id, refundRes.provider_refund_id, parsed.amount, refundRes.status, parsed.reason], tenantId);

  return res[0];
}

export async function ingestWebhookEvent(tenantId: string, provider: string, data: any) {
  const eventId = crypto.randomUUID();
  const provEventId = data.event_id || `EVT-${Math.floor(100000 + Math.random() * 900000)}`;

  const res = await withTenantQuery(`
    INSERT INTO payment_webhook_events (id, tenant_id, provider, event_type, provider_event_id, payload, processed)
    VALUES ($1, $2, $3, $4, $5, $6, true)
    ON CONFLICT (provider, provider_event_id) DO NOTHING RETURNING *;
  `, [eventId, tenantId, provider, data.event_type || 'payment.succeeded', provEventId, JSON.stringify(data)], tenantId);

  return res[0] || { status: "ignored_duplicate" };
}

export async function getPaymentLedger(tenantId: string, intentId: string) {
  if (!isValidUuid(intentId)) throw new AppError('Invalid Intent ID format.', 'BAD_REQUEST');

  const intentRes = await withTenantQuery(`
    SELECT * FROM payment_intents WHERE id = $1 AND tenant_id = $2;
  `, [intentId, tenantId], tenantId);
  const intent = intentRes[0];
  if (!intent) throw new AppError('Payment intent not found.', 'NOT_FOUND');

  const refunds = await withTenantQuery(`
    SELECT * FROM payment_refunds WHERE intent_id = $1 AND tenant_id = $2 ORDER BY created_at DESC;
  `, [intentId, tenantId], tenantId);

  return {
    ...intent,
    refunds
  };
}
