import * as crypto from 'crypto';
import { z } from 'zod';
import {
  AppError,
  ErrorCode,
  runCrudOperation
} from '@platform/crud-kernel';

export const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  currency: z.string().length(3).default('CAD')
});

const PaymentSchema = z.object({
  paymentId: z.string().uuid(),
  tenantId: z.string().uuid(),
  jobId: z.string().uuid(),
  amount: z.number().nonnegative(),
  method: z.enum([
    'card_on_file',
    'card_present',
    'cash',
    'other'
  ]),
  depositAmount: z.number().nonnegative(),
  status: z.enum([
    'pending',
    'paid',
    'partial',
    'refunded'
  ])
});

export type Payment = z.infer<typeof PaymentSchema>;

const paymentStore = new Map<string, Payment>();

export function __resetPaymentOnCompletionStore(): void {
  paymentStore.clear();
}

function getPaymentForJob(
  tenantId: string,
  jobId: string
): Payment | undefined {
  return Array.from(paymentStore.values()).find(
    payment =>
      payment.tenantId === tenantId &&
      payment.jobId === jobId
  );
}

function getPayment(
  tenantId: string,
  paymentId: string
): Payment {
  const payment = paymentStore.get(paymentId);

  if (!payment) {
    throw new AppError(
      'Payment record not found',
      ErrorCode.NOT_FOUND
    );
  }

  if (payment.tenantId !== tenantId) {
    throw new AppError(
      'Resource does not belong to tenant',
      ErrorCode.FORBIDDEN
    );
  }

  return payment;
}

function validateAmount(amount: number): void {
  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    throw new AppError(
      'Payment amount must be greater than zero',
      ErrorCode.BAD_REQUEST
    );
  }
}

export async function createPayment(
  tenantId: string,
  actorId: string,
  jobId: string,
  amount: number,
  method: Payment['method'] = 'other'
): Promise<Payment> {
  return runCrudOperation({
    configName: 'payment-on-completion',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (
        !z.string().uuid().safeParse(jobId).success
      ) {
        throw new AppError(
          'Invalid job ID',
          ErrorCode.BAD_REQUEST
        );
      }

      validateAmount(amount);

      if (getPaymentForJob(tenantId, jobId)) {
        throw new AppError(
          'Payment already exists for this job',
          ErrorCode.CONFLICT
        );
      }

      const payment = PaymentSchema.parse({
        paymentId: crypto.randomUUID(),
        tenantId,
        jobId,
        amount,
        method,
        depositAmount: 0,
        status: 'pending'
      });

      paymentStore.set(
        payment.paymentId,
        payment
      );

      return payment;
    },
    auditAction: 'data.created',
    auditResource: 'payment_on_completion',
    meterEventType: 'api_call'
  });
}

export async function chargeCardOnFile(
  tenantId: string,
  actorId: string,
  jobId: string,
  amount: number
): Promise<Payment> {
  return runCrudOperation({
    configName: 'payment-on-completion',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      validateAmount(amount);

      const payment = getPaymentForJob(
        tenantId,
        jobId
      );

      if (!payment) {
        throw new AppError(
          'Payment record not found',
          ErrorCode.NOT_FOUND
        );
      }

      if (amount > payment.amount) {
        throw new AppError(
          'Charge exceeds payment amount',
          ErrorCode.BAD_REQUEST
        );
      }

      payment.method = 'card_on_file';
      payment.status =
        amount === payment.amount
          ? 'paid'
          : 'partial';

      paymentStore.set(
        payment.paymentId,
        payment
      );

      return payment;
    },
    auditAction: 'data.updated',
    auditResource: 'payment_on_completion',
    meterEventType: 'api_call'
  });
}

export async function recordCashPayment(
  tenantId: string,
  actorId: string,
  jobId: string,
  amount: number
): Promise<Payment> {
  return runCrudOperation({
    configName: 'payment-on-completion',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      validateAmount(amount);

      const payment = getPaymentForJob(
        tenantId,
        jobId
      );

      if (!payment) {
        throw new AppError(
          'Payment record not found',
          ErrorCode.NOT_FOUND
        );
      }

      if (amount > payment.amount) {
        throw new AppError(
          'Cash payment exceeds payment amount',
          ErrorCode.BAD_REQUEST
        );
      }

      payment.method = 'cash';
      payment.status =
        amount === payment.amount
          ? 'paid'
          : 'partial';

      paymentStore.set(
        payment.paymentId,
        payment
      );

      return payment;
    },
    auditAction: 'data.updated',
    auditResource: 'payment_on_completion',
    meterEventType: 'api_call'
  });
}

export async function collectDeposit(
  tenantId: string,
  actorId: string,
  jobId: string,
  amount: number
): Promise<Payment> {
  return runCrudOperation({
    configName: 'payment-on-completion',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      validateAmount(amount);

      const payment = getPaymentForJob(
        tenantId,
        jobId
      );

      if (!payment) {
        throw new AppError(
          'Payment record not found',
          ErrorCode.NOT_FOUND
        );
      }

      if (amount > payment.amount) {
        throw new AppError(
          'Deposit exceeds payment amount',
          ErrorCode.BAD_REQUEST
        );
      }

      payment.depositAmount = amount;
      payment.status =
        amount === payment.amount
          ? 'paid'
          : 'partial';

      paymentStore.set(
        payment.paymentId,
        payment
      );

      return payment;
    },
    auditAction: 'data.updated',
    auditResource: 'payment_on_completion',
    meterEventType: 'api_call'
  });
}

export async function getPaymentStatus(
  tenantId: string,
  actorId: string,
  jobId: string
): Promise<Payment['status']> {
  return runCrudOperation({
    configName: 'payment-on-completion',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const payment = getPaymentForJob(
        tenantId,
        jobId
      );

      if (!payment) {
        throw new AppError(
          'Payment record not found',
          ErrorCode.NOT_FOUND
        );
      }

      return payment.status;
    },
    auditAction: 'data.read',
    auditResource: 'payment_on_completion',
    meterEventType: 'api_call'
  });
}
