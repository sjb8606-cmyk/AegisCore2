import * as crypto from 'crypto';
import { z } from 'zod';
import {
  AppError,
  ErrorCode,
  runCrudOperation
} from '@platform/crud-kernel';

export const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  baseRates: z.record(z.number().nonnegative()).default({}),
  frequencyMultipliers: z.record(z.number().positive()).default({
    weekly: 1,
    biweekly: 1.15,
    monthly: 1.35,
    seasonal: 1.5
  })
});

export const QuoteSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  clientId: z.string().uuid(),
  propertySizeSqft: z.number().positive(),
  serviceType: z.string().min(1).max(200),
  frequency: z.enum([
    'weekly',
    'biweekly',
    'monthly',
    'seasonal'
  ]),
  baseRate: z.number().nonnegative(),
  adjustments: z.array(
    z.object({
      reason: z.string().min(1).max(500),
      amount: z.number()
    })
  ),
  totalPrice: z.number().nonnegative(),
  status: z.enum([
    'draft',
    'sent',
    'accepted',
    'expired'
  ])
});

export type Quote = z.infer<typeof QuoteSchema>;

const quoteStore = new Map<string, Quote>();

export function __resetQuoteEstimateEngineStore(): void {
  quoteStore.clear();
}

function getQuote(
  tenantId: string,
  quoteId: string
): Quote {
  const quote = quoteStore.get(quoteId);

  if (!quote) {
    throw new AppError(
      'Quote not found',
      ErrorCode.NOT_FOUND
    );
  }

  if (quote.tenantId !== tenantId) {
    throw new AppError(
      'Resource does not belong to tenant',
      ErrorCode.FORBIDDEN
    );
  }

  return quote;
}

export async function calculateQuote(
  tenantId: string,
  actorId: string,
  clientId: string,
  propertySize: number,
  serviceType: string,
  frequency: Quote['frequency']
): Promise<Quote> {
  return runCrudOperation({
    configName: 'quote-estimate-engine',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (
        !Number.isFinite(propertySize) ||
        propertySize <= 0
      ) {
        throw new AppError(
          'Property size must be greater than zero',
          ErrorCode.BAD_REQUEST
        );
      }

      if (!serviceType.trim()) {
        throw new AppError(
          'Service type is required',
          ErrorCode.BAD_REQUEST
        );
      }

      const config = ConfigSchema.parse({
        enabled: true,
        baseRates: {
          default: 0.1
        }
      });

      const rate =
        config.baseRates[serviceType] ??
        config.baseRates.default ??
        0.1;

      const frequencyMultiplier =
        config.frequencyMultipliers[frequency] ?? 1;

      const baseRate =
        propertySize *
        rate *
        frequencyMultiplier;

      const quote = QuoteSchema.parse({
        id: crypto.randomUUID(),
        tenantId,
        clientId,
        propertySizeSqft: propertySize,
        serviceType: serviceType.trim(),
        frequency,
        baseRate,
        adjustments: [],
        totalPrice: baseRate,
        status: 'draft'
      });

      quoteStore.set(quote.id, quote);

      return quote;
    },
    auditAction: 'data.created',
    auditResource: 'quote',
    meterEventType: 'api_call'
  });
}

export async function applyAdjustment(
  tenantId: string,
  actorId: string,
  quoteId: string,
  reason: string,
  amount: number
): Promise<Quote> {
  return runCrudOperation({
    configName: 'quote-estimate-engine',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!reason.trim()) {
        throw new AppError(
          'Adjustment reason is required',
          ErrorCode.BAD_REQUEST
        );
      }

      if (!Number.isFinite(amount)) {
        throw new AppError(
          'Adjustment amount must be finite',
          ErrorCode.BAD_REQUEST
        );
      }

      const quote = getQuote(
        tenantId,
        quoteId
      );

      if (quote.status === 'accepted') {
        throw new AppError(
          'Accepted quotes cannot be adjusted',
          ErrorCode.CONFLICT
        );
      }

      quote.adjustments.push({
        reason: reason.trim(),
        amount
      });

      quote.totalPrice =
        quote.baseRate +
        quote.adjustments.reduce(
          (sum, adjustment) =>
            sum + adjustment.amount,
          0
        );

      if (quote.totalPrice < 0) {
        throw new AppError(
          'Quote total cannot be negative',
          ErrorCode.BAD_REQUEST
        );
      }

      quoteStore.set(quote.id, quote);

      return quote;
    },
    auditAction: 'data.updated',
    auditResource: 'quote',
    meterEventType: 'api_call'
  });
}

export async function convertToContract(
  tenantId: string,
  actorId: string,
  quoteId: string
): Promise<{
  contractId: string;
  quoteId: string;
  clientId: string;
  frequency: Quote['frequency'];
  totalPrice: number;
}> {
  return runCrudOperation({
    configName: 'quote-estimate-engine',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const quote = getQuote(
        tenantId,
        quoteId
      );

      if (quote.status !== 'accepted') {
        throw new AppError(
          'Only accepted quotes can be converted',
          ErrorCode.CONFLICT
        );
      }

      const contractId = crypto.randomUUID();

      return {
        contractId,
        quoteId: quote.id,
        clientId: quote.clientId,
        frequency: quote.frequency,
        totalPrice: quote.totalPrice
      };
    },
    auditAction: 'data.updated',
    auditResource: 'quote',
    meterEventType: 'api_call'
  });
}

export async function acceptQuote(
  tenantId: string,
  actorId: string,
  quoteId: string
): Promise<Quote> {
  return runCrudOperation({
    configName: 'quote-estimate-engine',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const quote = getQuote(
        tenantId,
        quoteId
      );

      if (
        quote.status !== 'draft' &&
        quote.status !== 'sent'
      ) {
        throw new AppError(
          'Quote cannot be accepted in its current state',
          ErrorCode.CONFLICT
        );
      }

      quote.status = 'accepted';
      quoteStore.set(quote.id, quote);

      return quote;
    },
    auditAction: 'data.updated',
    auditResource: 'quote',
    meterEventType: 'api_call'
  });
}
