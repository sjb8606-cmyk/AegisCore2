/**
 * @platform/expenses
 * Real total_cents sum from items; submit/approve state machine.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWithTenantQuery = vi.fn();
vi.mock('@platform/tenancy', () => ({
  withTenantQuery: (...a: unknown[]) => mockWithTenantQuery(...a),
}));
vi.mock('@platform/utils', () => ({
  AppError: class AppError extends Error {
    constructor(message: string, public code: string) { super(message); this.name = 'AppError'; }
  },
  ErrorCode: {
    FORBIDDEN: 'FORBIDDEN', BAD_REQUEST: 'BAD_REQUEST', NOT_FOUND: 'NOT_FOUND', RATE_LIMITED: 'RATE_LIMITED',
  },
  parseUserId: (id: string) => id,
}));
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn(),
}));

import {
  createExpenseReport, submitExpenseReport, approveExpenseReport, getExpenseDetails,
  AppError, ErrorCode,
} from '../index';

const TENANT = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';
const REPORT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('expenses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('createExpenseReport FORBIDDEN when disabled', async () => {
    const fs = await import('fs');
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue(JSON.stringify({
      enabled: false, tiers: {}, limits: { expensesPerMonth: 25000 }, thresholds: {},
    }));
    await expect(createExpenseReport(TENANT, USER, { title: 'Trip', items: [] }))
      .rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });

  it('createExpenseReport RATE_LIMITED at monthly cap', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([{ count: '25000' }]);
    await expect(createExpenseReport(TENANT, USER, { title: 'Trip', items: [] }))
      .rejects.toMatchObject({ code: ErrorCode.RATE_LIMITED });
  });

  it('createExpenseReport sums item amounts into total_cents', async () => {
    mockWithTenantQuery.mockImplementation(async (sql: string) => {
      if (/COUNT|seq|SELECT COUNT/i.test(sql) && !/INSERT|UPDATE/i.test(sql)) {
        return [{ count: '0', seq: '0' }];
      }
      if (/INSERT INTO expense_reports/i.test(sql)) {
        return [{ id: REPORT, title: 'Trip', report_number: 'EXP-20260101-0001' }];
      }
      if (/INSERT INTO expense_items/i.test(sql)) return [];
      if (/UPDATE expense_reports SET total_cents/i.test(sql)) return [];
      return [];
    });
    const result = await createExpenseReport(TENANT, USER, {
      title: 'Trip',
      items: [
        { category: 'travel', expenseDate: '2026-01-01', amount: 5000 },
        { category: 'meals', expenseDate: '2026-01-02', amount: 2500 },
      ],
    });
    expect(result.id).toBe(REPORT);
    expect(result.total_cents).toBe(7500);
    const totalCall = mockWithTenantQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && /total_cents/i.test(c[0]) && /UPDATE/i.test(c[0]),
    );
    expect(totalCall![1][0]).toBe(7500);
  });

  it('submitExpenseReport NOT_FOUND / only draft', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([]);
    await expect(submitExpenseReport(TENANT, REPORT, USER))
      .rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });

    mockWithTenantQuery.mockResolvedValueOnce([{ status: 'submitted' }]);
    await expect(submitExpenseReport(TENANT, REPORT, USER))
      .rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST, message: expect.stringMatching(/Only draft/i) });
  });

  it('submitExpenseReport transitions draft → submitted', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([{ status: 'draft' }]).mockResolvedValueOnce([]);
    const result = await submitExpenseReport(TENANT, REPORT, USER);
    expect(result).toEqual({ success: true, status: 'submitted' });
  });

  it('approveExpenseReport only from submitted', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([{ status: 'draft' }]);
    await expect(approveExpenseReport(TENANT, REPORT, USER, 'ok'))
      .rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST });
  });

  it('approveExpenseReport inserts approval and sets approved', async () => {
    mockWithTenantQuery
      .mockResolvedValueOnce([{ status: 'submitted' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const result = await approveExpenseReport(TENANT, REPORT, USER, 'looks good');
    expect(result).toEqual({ success: true });
    expect(mockWithTenantQuery.mock.calls[1][0]).toMatch(/expense_approvals/i);
    expect(mockWithTenantQuery.mock.calls[2][0]).toMatch(/status = 'approved'/i);
  });

  it('getExpenseDetails returns report with items and approvals', async () => {
    const report = { id: REPORT, title: 'Trip' };
    const items = [{ category: 'travel', amount_cents: 5000 }];
    const approvals = [{ status: 'approved' }];
    mockWithTenantQuery
      .mockResolvedValueOnce([report])
      .mockResolvedValueOnce(items)
      .mockResolvedValueOnce(approvals);
    const result = await getExpenseDetails(TENANT, REPORT);
    expect(result.items).toEqual(items);
    expect(result.approvals).toEqual(approvals);
  });
});
