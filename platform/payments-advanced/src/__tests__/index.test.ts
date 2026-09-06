/**
 * @platform/payments-advanced
 * LIMITATION: Stripe client is a hardcoded MockStripe that always returns the same card details
 *   regardless of stripePaymentMethodId (honest mock, not live Stripe).
 * GAP: jurisdiction is accepted by calculateTax but never used for rate lookup — always defaultRate.
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
  ErrorCode: { FORBIDDEN: 'FORBIDDEN', BAD_REQUEST: 'BAD_REQUEST', NOT_FOUND: 'NOT_FOUND' },
  parseUserId: (id: string) => id,
}));

const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
vi.mock('fs', () => ({
  existsSync: (...a: unknown[]) => mockExistsSync(...a),
  readFileSync: (...a: unknown[]) => mockReadFileSync(...a),
}));

import { initiateDunning, savePaymentMethod, calculateTax, AppError, ErrorCode } from '../index';

const TENANT = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';
const PAYMENT = '33333333-3333-3333-3333-333333333333';

describe('payments-advanced', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockExistsSync.mockReturnValue(false);
  });

  describe('initiateDunning', () => {
    it('FORBIDDEN when dunningManagement tier is off', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({
        enabled: true, tiers: { dunningManagement: false }, dunning: { retryIntervalDays: [1], maxRetries: 4 },
      }));
      await expect(initiateDunning(TENANT, PAYMENT, 5000))
        .rejects.toMatchObject({ code: ErrorCode.FORBIDDEN, message: expect.stringMatching(/dunningManagement/i) });
    });

    it('inserts dunning record with first retry interval and returns row', async () => {
      const row = { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', tenant_id: TENANT, payment_id: PAYMENT, amount_cents: 5000, max_attempts: 4 };
      mockWithTenantQuery.mockResolvedValueOnce([row]);
      const result = await initiateDunning(TENANT, PAYMENT, 5000, 'sub-1');
      expect(result).toEqual(row);
      const args = mockWithTenantQuery.mock.calls[0][1];
      expect(args[2]).toBe(PAYMENT);
      expect(args[3]).toBe('sub-1');
      expect(args[4]).toBe(4); // maxRetries default
      expect(args[6]).toBe(5000);
      expect(args[5]).toBeInstanceOf(Date);
    });
  });

  describe('savePaymentMethod', () => {
    it('FORBIDDEN when savedPaymentMethods tier is off', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({
        enabled: true, tiers: { savedPaymentMethods: false },
      }));
      await expect(savePaymentMethod(TENANT, USER, 'pm_test_123'))
        .rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    });

    it('retrieves mock Stripe PM and inserts saved method (LIMITATION: always last4=4242)', async () => {
      const row = {
        id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', tenant_id: TENANT, user_id: USER,
        stripe_pm_id: 'pm_test_123', last4: '4242', brand: 'visa',
      };
      mockWithTenantQuery.mockResolvedValueOnce([row]);
      const result = await savePaymentMethod(TENANT, USER, 'pm_test_123');
      expect(result).toEqual(row);
      expect(result.last4).toBe('4242'); // hardcoded mock
      expect(mockWithTenantQuery.mock.calls[0][0]).toMatch(/INSERT INTO saved_payment_methods/i);
    });
  });

  describe('calculateTax', () => {
    it('FORBIDDEN when taxCollection tier is off', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({
        enabled: true, tiers: { taxCollection: false }, tax: { defaultRate: 0.15 },
      }));
      await expect(calculateTax(TENANT, PAYMENT, 10000, 'US-CA'))
        .rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    });

    it('computes tax at defaultRate and inserts tax_records (GAP: jurisdiction ignored for rate)', async () => {
      const row = { id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', rate: 0.15, amount_cents: 1500, jurisdiction: 'US-CA' };
      mockWithTenantQuery.mockResolvedValueOnce([row]);
      const result = await calculateTax(TENANT, PAYMENT, 10000, 'US-CA');
      expect(result).toEqual(row);
      const args = mockWithTenantQuery.mock.calls[0][1];
      expect(args[3]).toBe('US-CA'); // stored but not used for rate
      expect(args[4]).toBe(0.15);
      expect(args[5]).toBe(1500); // Math.round(10000 * 0.15)
    });
  });
});
