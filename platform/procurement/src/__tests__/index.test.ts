/**
 * @platform/procurement
 * GAP: many tiers (rfqRfpWorkflows, contractManagement, budgetControls, …) exist in schema with no code paths.
 * NOTE in source: approve creates approval row at approve-time (not pre-assigned placeholder).
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

// generateRequestNumber is internal — exercised via createPurchaseRequest path
import {
  createPurchaseRequest, submitPurchaseRequest, approvePurchaseRequest, getPurchaseDetails,
  AppError, ErrorCode,
} from '../index';

const TENANT = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';
const REQ = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('procurement', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockExistsSync.mockReturnValue(false);
  });

  describe('createPurchaseRequest', () => {
    it('FORBIDDEN when disabled', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({
        enabled: false, tiers: {}, limits: {}, thresholds: {},
      }));
      await expect(createPurchaseRequest(TENANT, USER, { title: 'Laptops', items: [] }))
        .rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    });

    it('inserts header + items, updates total_cents, returns header', async () => {
      // generateRequestNumber typically does a count/select then we insert
      mockWithTenantQuery
        .mockResolvedValueOnce([{ count: '0' }]) // or whatever generateRequestNumber hits
        .mockResolvedValueOnce([{ id: REQ, title: 'Laptops', request_number: 'PR-0001' }]) // header
        .mockResolvedValueOnce([]) // item 1
        .mockResolvedValueOnce([]) // item 2
        .mockResolvedValueOnce([]); // update total

      // Make generateRequestNumber resilient: any SELECT returns count 0
      mockWithTenantQuery.mockImplementation(async (sql: string, params?: any[]) => {
        if (/COUNT|request_number|SELECT/i.test(sql) && !/INSERT|UPDATE/i.test(sql)) {
          return [{ count: '0', max: '0' }];
        }
        if (/INSERT INTO purchase_requests/i.test(sql)) {
          return [{ id: REQ, title: 'Laptops', request_number: params?.[2] || 'PR-1', total_cents: 0 }];
        }
        if (/INSERT INTO purchase_items/i.test(sql)) return [];
        if (/UPDATE purchase_requests SET total_cents/i.test(sql)) return [];
        return [];
      });

      const result = await createPurchaseRequest(TENANT, USER, {
        title: 'Laptops',
        description: 'Dev machines',
        items: [
          { name: 'MBP', quantity: 2, unitPrice: 150000 },
          { name: 'Dock', quantity: 2, unitPrice: 20000 },
        ],
      });
      expect(result.id).toBe(REQ);
      expect(result.title).toBe('Laptops');
      // 2*150000 + 2*20000 = 340000 — verify an UPDATE total was issued with that sum
      const totalCall = mockWithTenantQuery.mock.calls.find(
        (c) => typeof c[0] === 'string' && /total_cents/i.test(c[0]) && /UPDATE/i.test(c[0]),
      );
      expect(totalCall).toBeTruthy();
      expect(totalCall![1][0]).toBe(340000);
    });
  });

  describe('submitPurchaseRequest', () => {
    it('updates status to submitted', async () => {
      mockWithTenantQuery.mockResolvedValueOnce([]);
      const result = await submitPurchaseRequest(TENANT, REQ);
      expect(result).toEqual({ success: true, status: 'submitted' });
      expect(mockWithTenantQuery.mock.calls[0][0]).toMatch(/status = 'submitted'/i);
    });
  });

  describe('approvePurchaseRequest', () => {
    it('NOT_FOUND when request missing', async () => {
      mockWithTenantQuery.mockResolvedValueOnce([]);
      await expect(approvePurchaseRequest(TENANT, REQ, USER, 'looks good'))
        .rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });

    it('BAD_REQUEST when status is not submitted', async () => {
      mockWithTenantQuery.mockResolvedValueOnce([{ status: 'draft' }]);
      await expect(approvePurchaseRequest(TENANT, REQ, USER, 'ok'))
        .rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST, message: expect.stringMatching(/not pending/i) });
    });

    it('inserts approval row and sets request approved', async () => {
      mockWithTenantQuery
        .mockResolvedValueOnce([{ status: 'submitted' }])
        .mockResolvedValueOnce([]) // insert approval
        .mockResolvedValueOnce([]); // update request
      const result = await approvePurchaseRequest(TENANT, REQ, USER, 'approved after review');
      expect(result).toEqual({ success: true });
      expect(mockWithTenantQuery.mock.calls[1][0]).toMatch(/INSERT INTO purchase_approvals/i);
      expect(mockWithTenantQuery.mock.calls[2][0]).toMatch(/status = 'approved'/i);
    });
  });

  describe('getPurchaseDetails', () => {
    it('NOT_FOUND when missing', async () => {
      mockWithTenantQuery.mockResolvedValueOnce([]);
      await expect(getPurchaseDetails(TENANT, REQ)).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });

    it('returns request with items and approvals', async () => {
      const header = { id: REQ, title: 'Laptops', status: 'approved' };
      const items = [{ id: 'i1', name: 'MBP', quantity: 2, unit_price_cents: 150000, total_cents: 300000 }];
      const approvals = [{ id: 'a1', status: 'approved', reason: 'ok' }];
      mockWithTenantQuery
        .mockResolvedValueOnce([header])
        .mockResolvedValueOnce(items)
        .mockResolvedValueOnce(approvals);
      const result = await getPurchaseDetails(TENANT, REQ);
      expect(result.id).toBe(REQ);
      expect(result.items).toEqual(items);
      expect(result.approvals).toEqual(approvals);
    });
  });
});
