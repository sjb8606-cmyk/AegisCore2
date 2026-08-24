import * as crypto from 'crypto';
import { z } from 'zod';
import {
  runCrudOperation,
  AppError,
  ErrorCode
} from '@platform/crud-kernel';
import { loadConfig } from '@platform/utils';
import { getLogger } from '@platform/observability';

const logger = getLogger(
  'expense-receipt-capture-approval'
);

export const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  max_expense_amount: z
    .number()
    .positive()
    .default(1000000)
});

export type ApprovalStatus =
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'reimbursed';

export interface ReceiptOcrData {
  merchant_name?: string;
  transaction_date?: string;
  total?: number;
  currency?: string;
  raw_text?: string;
}

export interface ExpenseRecord {
  expense_id: string;
  tenant_id: string;
  employee_id: string;
  amount: number;
  category: string;
  receipt_image_url: string;
  ocr_extracted_data: ReceiptOcrData;
  approval_status: ApprovalStatus;
  approver_id?: string;
  created_at: string;
  updated_at: string;
}

const expenseStore =
  new Map<string, ExpenseRecord>();

export function __resetExpenseReceiptCaptureApprovalStore(): void {
  expenseStore.clear();
}

function getConfig() {
  return loadConfig(
    'expense-receipt-capture-approval',
    ConfigSchema
  );
}

export async function submitExpense(
  tenantId: string,
  actorId: string,
  employeeId: string,
  amount: number,
  category: string,
  receiptImageUrl: string
): Promise<ExpenseRecord> {
  return runCrudOperation({
    configName: 'expense-receipt-capture-approval',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = getConfig();

      if (!config.enabled) {
        throw new AppError(
          ErrorCode.FORBIDDEN,
          'Expense receipt capture is disabled'
        );
      }

      if (
        !Number.isFinite(amount) ||
        amount <= 0
      ) {
        throw new AppError(
          ErrorCode.BAD_REQUEST,
          'Expense amount must be greater than zero'
        );
      }

      if (
        amount > config.max_expense_amount
      ) {
        throw new AppError(
          ErrorCode.BAD_REQUEST,
          'Expense amount exceeds configured maximum'
        );
      }

      if (!category.trim()) {
        throw new AppError(
          ErrorCode.BAD_REQUEST,
          'Expense category is required'
        );
      }

      if (!receiptImageUrl.trim()) {
        throw new AppError(
          ErrorCode.BAD_REQUEST,
          'Receipt image is required'
        );
      }

      const now = new Date().toISOString();

      const record: ExpenseRecord = {
        expense_id: crypto.randomUUID(),
        tenant_id: tenantId,
        employee_id: employeeId,
        amount,
        category,
        receipt_image_url: receiptImageUrl,
        ocr_extracted_data: {},
        approval_status: 'submitted',
        created_at: now,
        updated_at: now
      };

      expenseStore.set(
        record.expense_id,
        record
      );

      logger.info(
        'Expense submitted',
        {
          tenantId,
          employeeId,
          expenseId: record.expense_id,
          amount
        }
      );

      return record;
    },
    auditAction: 'data.created',
    auditResource: 'employee_expense',
    meterEventType: 'api_call'
  });
}

export async function extractReceiptData(
  tenantId: string,
  actorId: string,
  expenseId: string,
  ocrData: ReceiptOcrData
): Promise<ExpenseRecord> {
  return runCrudOperation({
    configName: 'expense-receipt-capture-approval',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const record =
        expenseStore.get(expenseId);

      if (
        !record ||
        record.tenant_id !== tenantId
      ) {
        throw new AppError(
          ErrorCode.NOT_FOUND,
          'Expense not found'
        );
      }

      const updated: ExpenseRecord = {
        ...record,
        ocr_extracted_data: {
          ...record.ocr_extracted_data,
          ...ocrData
        },
        updated_at:
          new Date().toISOString()
      };

      expenseStore.set(
        expenseId,
        updated
      );

      return updated;
    },
    auditAction: 'data.updated',
    auditResource: 'employee_expense',
    meterEventType: 'api_call'
  });
}

export async function approveExpense(
  tenantId: string,
  actorId: string,
  expenseId: string,
  approverId: string
): Promise<ExpenseRecord> {
  return runCrudOperation({
    configName: 'expense-receipt-capture-approval',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const record =
        expenseStore.get(expenseId);

      if (
        !record ||
        record.tenant_id !== tenantId
      ) {
        throw new AppError(
          ErrorCode.NOT_FOUND,
          'Expense not found'
        );
      }

      if (
        record.approval_status !==
        'submitted'
      ) {
        throw new AppError(
          ErrorCode.BAD_REQUEST,
          'Only submitted expenses can be approved'
        );
      }

      if (!approverId.trim()) {
        throw new AppError(
          ErrorCode.BAD_REQUEST,
          'Approver ID is required'
        );
      }

      const updated: ExpenseRecord = {
        ...record,
        approval_status: 'approved',
        approver_id: approverId,
        updated_at:
          new Date().toISOString()
      };

      expenseStore.set(
        expenseId,
        updated
      );

      return updated;
    },
    auditAction: 'data.updated',
    auditResource: 'employee_expense',
    meterEventType: 'api_call'
  });
}

export async function rejectExpense(
  tenantId: string,
  actorId: string,
  expenseId: string,
  approverId: string
): Promise<ExpenseRecord> {
  return runCrudOperation({
    configName: 'expense-receipt-capture-approval',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const record =
        expenseStore.get(expenseId);

      if (
        !record ||
        record.tenant_id !== tenantId
      ) {
        throw new AppError(
          ErrorCode.NOT_FOUND,
          'Expense not found'
        );
      }

      if (
        record.approval_status !==
        'submitted'
      ) {
        throw new AppError(
          ErrorCode.BAD_REQUEST,
          'Only submitted expenses can be rejected'
        );
      }

      const updated: ExpenseRecord = {
        ...record,
        approval_status: 'rejected',
        approver_id: approverId,
        updated_at:
          new Date().toISOString()
      };

      expenseStore.set(
        expenseId,
        updated
      );

      return updated;
    },
    auditAction: 'data.updated',
    auditResource: 'employee_expense',
    meterEventType: 'api_call'
  });
}

export async function markReimbursed(
  tenantId: string,
  actorId: string,
  expenseId: string
): Promise<ExpenseRecord> {
  return runCrudOperation({
    configName: 'expense-receipt-capture-approval',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const record =
        expenseStore.get(expenseId);

      if (
        !record ||
        record.tenant_id !== tenantId
      ) {
        throw new AppError(
          ErrorCode.NOT_FOUND,
          'Expense not found'
        );
      }

      if (
        record.approval_status !==
        'approved'
      ) {
        throw new AppError(
          ErrorCode.BAD_REQUEST,
          'Only approved expenses can be reimbursed'
        );
      }

      const updated: ExpenseRecord = {
        ...record,
        approval_status: 'reimbursed',
        updated_at:
          new Date().toISOString()
      };

      expenseStore.set(
        expenseId,
        updated
      );

      return updated;
    },
    auditAction: 'data.updated',
    auditResource: 'employee_expense',
    meterEventType: 'api_call'
  });
}

export function getExpense(
  tenantId: string,
  expenseId: string
): ExpenseRecord | undefined {
  const record =
    expenseStore.get(expenseId);

  if (
    !record ||
    record.tenant_id !== tenantId
  ) {
    return undefined;
  }

  return record;
}
