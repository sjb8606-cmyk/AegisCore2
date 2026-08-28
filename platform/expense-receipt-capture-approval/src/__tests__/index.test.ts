import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

vi.mock('@platform/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platform/utils')>();
  return {
    ...actual,
  loadConfig: vi.fn(() => ({
    enabled: true,
    max_expense_amount: 1000000
    }))
  };
});

vi.mock('@platform/observability', () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }))
}));

vi.mock('@platform/crud-kernel', () => {
  class TestAppError extends Error {
    code: string;

    constructor(
      code: string,
      message: string
    ) {
      super(message);
      this.code = code;
    }
  }

  return {
    AppError: TestAppError,
    ErrorCode: {
      BAD_REQUEST: 'BAD_REQUEST',
      FORBIDDEN: 'FORBIDDEN',
      NOT_FOUND: 'NOT_FOUND'
    },
    runCrudOperation: async (args: {
      action: () => Promise<unknown>;
    }) => args.action()
  };
});

import {
  __resetExpenseReceiptCaptureApprovalStore,
  submitExpense,
  extractReceiptData,
  approveExpense,
  markReimbursed,
  getExpense
} from '../index';

describe(
  'expense-receipt-capture-approval',
  () => {
    beforeEach(() => {
      __resetExpenseReceiptCaptureApprovalStore();
    });

    it('submits an expense with receipt metadata', async () => {
      const result =
        await submitExpense(
          'tenant-1',
          'employee-1',
          'employee-1',
          84.50,
          'Travel',
          'receipts/receipt-001.jpg'
        );

      expect(result.amount).toBe(84.50);
      expect(result.category).toBe(
        'Travel'
      );
      expect(
        result.approval_status
      ).toBe('submitted');
    });

    it('stores OCR receipt data', async () => {
      const expense =
        await submitExpense(
          'tenant-1',
          'employee-1',
          'employee-1',
          125,
          'Meals',
          'receipts/receipt-002.jpg'
        );

      const result =
        await extractReceiptData(
          'tenant-1',
          'employee-1',
          expense.expense_id,
          {
            merchant_name: 'Example Restaurant',
            transaction_date: '2026-08-23',
            total: 125,
            currency: 'CAD'
          }
        );

      expect(
        result.ocr_extracted_data.merchant_name
      ).toBe('Example Restaurant');

      expect(
        result.ocr_extracted_data.total
      ).toBe(125);
    });

    it('supports the approval workflow', async () => {
      const expense =
        await submitExpense(
          'tenant-1',
          'employee-1',
          'employee-1',
          200,
          'Supplies',
          'receipts/receipt-003.jpg'
        );

      const approved =
        await approveExpense(
          'tenant-1',
          'manager-1',
          expense.expense_id,
          'manager-1'
        );

      expect(
        approved.approval_status
      ).toBe('approved');

      const reimbursed =
        await markReimbursed(
          'tenant-1',
          'finance-1',
          expense.expense_id
        );

      expect(
        reimbursed.approval_status
      ).toBe('reimbursed');
    });

    it('prevents reimbursement before approval', async () => {
      const expense =
        await submitExpense(
          'tenant-1',
          'employee-1',
          'employee-1',
          50,
          'Office',
          'receipts/receipt-004.jpg'
        );

      await expect(
        markReimbursed(
          'tenant-1',
          'finance-1',
          expense.expense_id
        )
      ).rejects.toThrow(
        'Only approved expenses can be reimbursed'
      );
    });

    it('enforces tenant isolation', async () => {
      const expense =
        await submitExpense(
          'tenant-1',
          'employee-1',
          'employee-1',
          75,
          'Office',
          'receipts/receipt-005.jpg'
        );

      expect(
        getExpense(
          'tenant-2',
          expense.expense_id
        )
      ).toBeUndefined();
    });
  }
);
