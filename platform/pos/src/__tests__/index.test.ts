/**
 * @platform/pos
 * Real cash variance math exercised on closeSession success path.
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

import { openSession, createTransaction, closeSession, AppError, ErrorCode } from '../index';

const TENANT = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';
const REGISTER = 'reg-1';
const SESSION = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('pos', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockExistsSync.mockReturnValue(false);
  });

  describe('openSession', () => {
    it('FORBIDDEN when POS disabled', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ enabled: false }));
      await expect(openSession(TENANT, REGISTER, 10000, USER))
        .rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    });

    it('BAD_REQUEST when register already has open session', async () => {
      mockWithTenantQuery.mockResolvedValueOnce([{ id: SESSION }]);
      await expect(openSession(TENANT, REGISTER, 10000, USER))
        .rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST, message: expect.stringMatching(/already has an active/i) });
    });

    it('inserts and returns new session', async () => {
      const row = { id: SESSION, register_id: REGISTER, opening_cash_cents: 10000, status: 'open' };
      mockWithTenantQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([row]);
      const result = await openSession(TENANT, REGISTER, 10000, USER);
      expect(result).toEqual(row);
      expect(mockWithTenantQuery.mock.calls[1][0]).toMatch(/INSERT INTO pos_sessions/i);
    });
  });

  describe('createTransaction', () => {
    it('FORBIDDEN when no open session on register', async () => {
      mockWithTenantQuery.mockResolvedValueOnce([]);
      await expect(createTransaction(TENANT, USER, { registerId: REGISTER, items: [] }))
        .rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    });

    it('sums line items (qty * unitPrice - discount) and inserts', async () => {
      const tx = { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', total_amount_cents: 1750 };
      mockWithTenantQuery.mockResolvedValueOnce([{ id: SESSION }]).mockResolvedValueOnce([tx]);
      const result = await createTransaction(TENANT, USER, {
        registerId: REGISTER,
        items: [
          { quantity: 2, unitPrice: 1000, discountAmount: 250 },
          { quantity: 1, unitPrice: 1000, discountAmount: 0 },
        ],
        payments: [{ method: 'cash', amountCents: 1750 }],
      });
      expect(result).toEqual(tx);
      // 2*1000-250 + 1*1000 = 1750
      expect(mockWithTenantQuery.mock.calls[1][1][4]).toBe(1750);
    });
  });

  describe('closeSession', () => {
    it('NOT_FOUND when open session missing', async () => {
      mockWithTenantQuery.mockResolvedValueOnce([]);
      await expect(closeSession(TENANT, SESSION, 12000, USER))
        .rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });

    it('computes expected cash, variance, and limit_breached correctly', async () => {
      mockWithTenantQuery
        .mockResolvedValueOnce([{ opening_cash_cents: '10000' }]) // locked session
        .mockResolvedValueOnce([{ total: '2500' }])              // tx sum
        .mockResolvedValueOnce([]);                               // update
      const result = await closeSession(TENANT, SESSION, 13000, USER);
      // expected = 10000 + 2500 = 12500; variance = 13000 - 12500 = 500
      expect(result).toEqual({
        success: true,
        opening_cash_cents: 10000,
        expected_cash_cents: 12500,
        variance_cents: 500,
        limit_breached: false, // default maxCashVariance 500 → |500| > 500 is false
      });
    });

    it('sets limit_breached true when |variance| exceeds threshold', async () => {
      mockWithTenantQuery
        .mockResolvedValueOnce([{ opening_cash_cents: '10000' }])
        .mockResolvedValueOnce([{ total: '0' }])
        .mockResolvedValueOnce([]);
      const result = await closeSession(TENANT, SESSION, 10600, USER);
      expect(result.variance_cents).toBe(600);
      expect(result.limit_breached).toBe(true);
    });
  });
});
