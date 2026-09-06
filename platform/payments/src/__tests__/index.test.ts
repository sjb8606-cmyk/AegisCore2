/**
 * @platform/payments
 * DEFECT: resolveDriver(tenantId) always returns PayPalDriver regardless of tenantId / config.
 * LIMITATION: drivers are honest local mocks (no live network).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWithTenantQuery = vi.fn();
vi.mock('@platform/tenancy', () => ({
  withTenantQuery: (...args: unknown[]) => mockWithTenantQuery(...args),
}));

vi.mock('@platform/utils', () => ({
  AppError: class AppError extends Error {
    constructor(message: string, public code: string) { super(message); this.name = 'AppError'; }
  },
  ErrorCode: {
    FORBIDDEN: 'FORBIDDEN', BAD_REQUEST: 'BAD_REQUEST', NOT_FOUND: 'NOT_FOUND',
  },
  parseUserId: (id: string) => id,
  isValidUuid: (id: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
}));

const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
vi.mock('fs', () => ({
  existsSync: (...a: unknown[]) => mockExistsSync(...a),
  readFileSync: (...a: unknown[]) => mockReadFileSync(...a),
}));

import {
  createPaymentIntent, confirmPaymentIntent, cancelPaymentIntent,
  attachPaymentMethod, issueRefund, ingestWebhookEvent, getPaymentLedger,
  resolveDriver, PaymentDriverRegistry, PayPalDriver, StripeDriver, CryptoDriver,
  CreateIntentSchema, AppError, ErrorCode,
} from '../index';

const TENANT = '11111111-1111-1111-1111-111111111111';
const INTENT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CUSTOMER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

describe('payments', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockExistsSync.mockReturnValue(false);
  });

  describe('resolveDriver', () => {
    // DEFECT lock-in
    it('always resolves paypal regardless of tenantId (DEFECT – should be tenant/config driven)', async () => {
      const driver = await resolveDriver(TENANT);
      expect(driver.providerId).toBe('paypal');
      const other = await resolveDriver('99999999-9999-9999-9999-999999999999');
      expect(other.providerId).toBe('paypal');
    });

    it('PaymentDriverRegistry throws for unknown provider', () => {
      expect(() => PaymentDriverRegistry.resolve('unknown-xyz'))
        .toThrow(/Unsupported payment provider/);
    });

    it('drivers produce expected shapes', async () => {
      const pp = new PayPalDriver();
      const st = new StripeDriver();
      const cr = new CryptoDriver();
      expect((await pp.createIntent({ amount: 100 })).provider_intent_id).toMatch(/^PAYPAL-INT-/);
      expect((await st.createIntent({ amount: 100 })).provider_intent_id).toMatch(/^STRIPE-INT-/);
      expect((await cr.createIntent({ amount: 100 })).provider_intent_id).toMatch(/^CRYPTO-TX-/);
    });
  });

  describe('createPaymentIntent', () => {
    it('FORBIDDEN when payments disabled', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ enabled: false }));
      await expect(createPaymentIntent(TENANT, {
        amount: 1000, currency: 'USD', idempotency_key: 'idem-1',
      })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('rejects invalid schema (amount not positive)', async () => {
      await expect(createPaymentIntent(TENANT, {
        amount: -5, idempotency_key: 'idem-2',
      })).rejects.toThrow();
    });

    it('returns existing intent on idempotency hit', async () => {
      const existing = { id: INTENT, idempotency_key: 'idem-3', amount: 1000 };
      mockWithTenantQuery.mockResolvedValueOnce([existing]);
      const result = await createPaymentIntent(TENANT, {
        amount: 1000, idempotency_key: 'idem-3',
      });
      expect(result).toEqual(existing);
      expect(mockWithTenantQuery).toHaveBeenCalledTimes(1); // no insert
    });

    it('creates new intent via driver and inserts row', async () => {
      const inserted = {
        id: INTENT, tenant_id: TENANT, provider: 'paypal',
        amount: 2500, currency: 'USD', status: 'pending', idempotency_key: 'idem-4',
      };
      mockWithTenantQuery
        .mockResolvedValueOnce([])           // no existing
        .mockResolvedValueOnce([inserted]);  // insert
      const result = await createPaymentIntent(TENANT, {
        amount: 2500, currency: 'USD', idempotency_key: 'idem-4',
      });
      expect(result).toEqual(inserted);
      expect(mockWithTenantQuery.mock.calls[1][0]).toMatch(/INSERT INTO payment_intents/i);
      expect(mockWithTenantQuery.mock.calls[1][1][2]).toBe('paypal'); // DEFECT path
    });
  });

  describe('confirmPaymentIntent', () => {
    it('BAD_REQUEST on invalid UUID', async () => {
      await expect(confirmPaymentIntent(TENANT, 'not-a-uuid'))
        .rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });

    it('NOT_FOUND when intent missing', async () => {
      mockWithTenantQuery.mockResolvedValueOnce([]);
      await expect(confirmPaymentIntent(TENANT, INTENT))
        .rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('confirms via driver and updates status to succeeded', async () => {
      const intent = { id: INTENT, provider_intent_id: 'PAYPAL-INT-abc', status: 'pending' };
      const updated = { ...intent, status: 'succeeded' };
      mockWithTenantQuery.mockResolvedValueOnce([intent]).mockResolvedValueOnce([updated]);
      const result = await confirmPaymentIntent(TENANT, INTENT);
      expect(result.status).toBe('succeeded');
      expect(mockWithTenantQuery.mock.calls[1][0]).toMatch(/UPDATE payment_intents SET status/i);
    });
  });

  describe('cancelPaymentIntent', () => {
    it('NOT_FOUND when intent missing', async () => {
      mockWithTenantQuery.mockResolvedValueOnce([]);
      await expect(cancelPaymentIntent(TENANT, INTENT))
        .rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('cancels and sets status canceled', async () => {
      const intent = { id: INTENT, provider_intent_id: 'PAYPAL-INT-xyz', status: 'pending' };
      const updated = { ...intent, status: 'canceled' };
      mockWithTenantQuery.mockResolvedValueOnce([intent]).mockResolvedValueOnce([updated]);
      const result = await cancelPaymentIntent(TENANT, INTENT);
      expect(result.status).toBe('canceled');
    });
  });

  describe('attachPaymentMethod', () => {
    it('rejects invalid schema (last_four length)', async () => {
      await expect(attachPaymentMethod(TENANT, {
        customer_ref: CUSTOMER, provider: 'stripe', token: 'tok_1', last_four: '12', brand: 'visa',
      })).rejects.toThrow();
    });

    it('inserts payment method row', async () => {
      const row = { id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', last_four: '4242', brand: 'visa' };
      mockWithTenantQuery.mockResolvedValueOnce([row]);
      const result = await attachPaymentMethod(TENANT, {
        customer_ref: CUSTOMER, provider: 'stripe', token: 'tok_1', last_four: '4242', brand: 'visa',
      });
      expect(result).toEqual(row);
      expect(mockWithTenantQuery.mock.calls[0][0]).toMatch(/INSERT INTO payment_methods/i);
    });
  });

  describe('issueRefund', () => {
    it('NOT_FOUND when intent missing', async () => {
      mockWithTenantQuery.mockResolvedValueOnce([]);
      await expect(issueRefund(TENANT, { intent_id: INTENT, amount: 100 }))
        .rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('BAD_REQUEST when intent not succeeded', async () => {
      mockWithTenantQuery.mockResolvedValueOnce([{ id: INTENT, status: 'pending', amount: 1000 }]);
      await expect(issueRefund(TENANT, { intent_id: INTENT, amount: 100 }))
        .rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringMatching(/un-captured|failed/i) });
    });

    it('BAD_REQUEST when refund would exceed intent amount', async () => {
      mockWithTenantQuery
        .mockResolvedValueOnce([{ id: INTENT, status: 'succeeded', amount: 1000 }])
        .mockResolvedValueOnce([{ total_refunded: '900' }]);
      await expect(issueRefund(TENANT, { intent_id: INTENT, amount: 200 }))
        .rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringMatching(/exceeds absolute limit/i) });
    });

    it('issues refund and inserts payment_refunds row', async () => {
      const refundRow = { id: 'dddddddd-dddd-dddd-dddd-dddddddddddd', amount: 250, status: 'succeeded' };
      mockWithTenantQuery
        .mockResolvedValueOnce([{ id: INTENT, status: 'succeeded', amount: 1000 }])
        .mockResolvedValueOnce([{ total_refunded: '0' }])
        .mockResolvedValueOnce([refundRow]);
      const result = await issueRefund(TENANT, { intent_id: INTENT, amount: 250, reason: 'customer_request' });
      expect(result).toEqual(refundRow);
      expect(mockWithTenantQuery.mock.calls[2][0]).toMatch(/INSERT INTO payment_refunds/i);
    });
  });

  describe('ingestWebhookEvent / getPaymentLedger', () => {
    it('inserts webhook event or returns ignored_duplicate', async () => {
      mockWithTenantQuery.mockResolvedValueOnce([{ id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' }]);
      const row = await ingestWebhookEvent(TENANT, 'paypal', { event_type: 'payment.succeeded', event_id: 'EVT-1' });
      expect(row.id).toBeDefined();

      mockWithTenantQuery.mockResolvedValueOnce([]); // ON CONFLICT DO NOTHING → empty
      const dup = await ingestWebhookEvent(TENANT, 'paypal', { event_type: 'payment.succeeded', event_id: 'EVT-1' });
      expect(dup).toEqual({ status: 'ignored_duplicate' });
    });

    it('getPaymentLedger NOT_FOUND / success with refunds', async () => {
      mockWithTenantQuery.mockResolvedValueOnce([]);
      await expect(getPaymentLedger(TENANT, INTENT)).rejects.toMatchObject({ code: 'NOT_FOUND' });

      const intent = { id: INTENT, amount: 1000, status: 'succeeded' };
      const refunds = [{ id: 'ffffffff-ffff-ffff-ffff-ffffffffffff', amount: 100 }];
      mockWithTenantQuery.mockResolvedValueOnce([intent]).mockResolvedValueOnce(refunds);
      const ledger = await getPaymentLedger(TENANT, INTENT);
      expect(ledger.id).toBe(INTENT);
      expect(ledger.refunds).toEqual(refunds);
    });
  });
});
