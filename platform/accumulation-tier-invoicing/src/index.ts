import * as crypto from 'crypto';
import { z } from 'zod';
import {
  AppError,
  ErrorCode,
  runCrudOperation
} from '@platform/crud-kernel';

export const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  tiers: z.array(
    z.object({
      maxInches: z.number().nonnegative().nullable(),
      rate: z.number().nonnegative()
    })
  ).min(1)
});

type Tier = {
  maxInches: number | null;
  rate: number;
};

type AccumulationInvoice = {
  invoiceId: string;
  tenantId: string;
  propertyId: string;
  accumulationInches: number;
  tierApplied: number;
  tierRate: number;
  totalAmount: number;
};

const invoiceStore =
  new Map<string, AccumulationInvoice>();

const DEFAULT_TIERS: Tier[] = [
  { maxInches: 2, rate: 100 },
  { maxInches: 6, rate: 175 },
  { maxInches: null, rate: 250 }
];

export function __resetAccumulationTierInvoicingStore(): void {
  invoiceStore.clear();
}

export function calculateTier(
  accumulationInches: number,
  tiers: Tier[] = DEFAULT_TIERS
): number {
  if (
    !Number.isFinite(accumulationInches) ||
    accumulationInches < 0
  ) {
    throw new AppError(
      'Accumulation must be zero or greater',
      ErrorCode.BAD_REQUEST
    );
  }

  const index = tiers.findIndex(
    (tier) =>
      tier.maxInches === null ||
      accumulationInches <= tier.maxInches
  );

  if (index === -1) {
    return tiers.length;
  }

  return index + 1;
}

export async function generateTieredInvoice(
  tenantId: string,
  actorId: string,
  propertyId: string,
  accumulationInches: number
): Promise<AccumulationInvoice> {
  return runCrudOperation({
    configName: 'accumulation-tier-invoicing',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (
        !Number.isFinite(accumulationInches) ||
        accumulationInches < 0
      ) {
        throw new AppError(
          'Accumulation must be zero or greater',
          ErrorCode.BAD_REQUEST
        );
      }

      const tierApplied =
        calculateTier(accumulationInches);

      const tierRate =
        DEFAULT_TIERS[tierApplied - 1]?.rate;

      if (tierRate === undefined) {
        throw new AppError(
          'No accumulation pricing tier is configured',
          ErrorCode.CONFLICT
        );
      }

      const invoice: AccumulationInvoice = {
        invoiceId: crypto.randomUUID(),
        tenantId,
        propertyId,
        accumulationInches,
        tierApplied,
        tierRate,
        totalAmount: tierRate
      };

      invoiceStore.set(invoice.invoiceId, invoice);

      return invoice;
    },
    auditAction: 'data.created',
    auditResource: 'accumulation_tier_invoice',
    meterEventType: 'api_call'
  });
}

export async function getInvoice(
  tenantId: string,
  actorId: string,
  invoiceId: string
): Promise<AccumulationInvoice> {
  return runCrudOperation({
    configName: 'accumulation-tier-invoicing',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const invoice = invoiceStore.get(invoiceId);

      if (!invoice || invoice.tenantId !== tenantId) {
        throw new AppError(
          'Invoice not found',
          ErrorCode.NOT_FOUND
        );
      }

      return invoice;
    },
    auditAction: 'data.read',
    auditResource: 'accumulation_tier_invoice',
    meterEventType: 'api_call'
  });
}
