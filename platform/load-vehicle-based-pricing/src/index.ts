import * as crypto from 'crypto';
import { z } from 'zod';
import {
  AppError,
  ErrorCode,
  runCrudOperation
} from '@platform/crud-kernel';

export const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  baseRate: z.number().nonnegative().default(100),
  distanceRatePerMile: z.number().nonnegative().default(2),
  volumeFactorRate: z.number().nonnegative().default(10)
});

const SurchargeSchema = z.object({
  reason: z.string().min(1).max(500),
  amount: z.number().finite()
});

const PricingSchema = z.object({
  pricingId: z.string().uuid(),
  tenantId: z.string().uuid(),
  jobId: z.string().uuid(),
  baseRate: z.number().nonnegative(),
  distanceMiles: z.number().nonnegative(),
  distanceRatePerMile: z.number().nonnegative(),
  volumeOrSizeFactor: z.number().nonnegative(),
  surcharges: z.array(SurchargeSchema),
  totalPrice: z.number().nonnegative()
});

export type PricingSurcharge =
  z.infer<typeof SurchargeSchema>;

export type LoadVehiclePricing =
  z.infer<typeof PricingSchema>;

const pricingStore =
  new Map<string, LoadVehiclePricing>();

export function __resetLoadVehicleBasedPricingStore(): void {
  pricingStore.clear();
}

function getPricing(
  tenantId: string,
  pricingId: string
): LoadVehiclePricing {
  const pricing = pricingStore.get(pricingId);

  if (!pricing) {
    throw new AppError(
      'Pricing record not found',
      ErrorCode.NOT_FOUND
    );
  }

  if (pricing.tenantId !== tenantId) {
    throw new AppError(
      'Resource does not belong to tenant',
      ErrorCode.FORBIDDEN
    );
  }

  return pricing;
}

function calculateTotal(
  baseRate: number,
  distanceMiles: number,
  distanceRatePerMile: number,
  volumeOrSizeFactor: number,
  volumeFactorRate: number,
  surcharges: PricingSurcharge[]
): number {
  const surchargeTotal = surcharges.reduce(
    (sum, item) => sum + item.amount,
    0
  );

  return Math.max(
    0,
    baseRate +
      distanceMiles * distanceRatePerMile +
      volumeOrSizeFactor * volumeFactorRate +
      surchargeTotal
  );
}

export async function calculatePrice(
  tenantId: string,
  actorId: string,
  jobId: string,
  distance: number,
  volumeOrSizeFactor: number
): Promise<LoadVehiclePricing> {
  return runCrudOperation({
    configName: 'load-vehicle-based-pricing',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!z.string().uuid().safeParse(jobId).success) {
        throw new AppError(
          'Invalid job ID',
          ErrorCode.BAD_REQUEST
        );
      }

      if (
        !Number.isFinite(distance) ||
        distance < 0
      ) {
        throw new AppError(
          'Distance must be non-negative',
          ErrorCode.BAD_REQUEST
        );
      }

      if (
        !Number.isFinite(volumeOrSizeFactor) ||
        volumeOrSizeFactor < 0
      ) {
        throw new AppError(
          'Volume or size factor must be non-negative',
          ErrorCode.BAD_REQUEST
        );
      }

      const config = ConfigSchema.parse({});

      const existing = Array.from(
        pricingStore.values()
      ).find(
        pricing =>
          pricing.tenantId === tenantId &&
          pricing.jobId === jobId
      );

      if (existing) {
        throw new AppError(
          'Pricing already exists for this job',
          ErrorCode.CONFLICT
        );
      }

      const pricing =
        PricingSchema.parse({
          pricingId: crypto.randomUUID(),
          tenantId,
          jobId,
          baseRate: config.baseRate,
          distanceMiles: distance,
          distanceRatePerMile:
            config.distanceRatePerMile,
          volumeOrSizeFactor,
          surcharges: [],
          totalPrice: calculateTotal(
            config.baseRate,
            distance,
            config.distanceRatePerMile,
            volumeOrSizeFactor,
            config.volumeFactorRate,
            []
          )
        });

      pricingStore.set(
        pricing.pricingId,
        pricing
      );

      return pricing;
    },
    auditAction: 'data.created',
    auditResource: 'load_vehicle_pricing',
    meterEventType: 'api_call'
  });
}

export async function applySurcharge(
  tenantId: string,
  actorId: string,
  pricingId: string,
  reason: string,
  amount: number
): Promise<LoadVehiclePricing> {
  return runCrudOperation({
    configName: 'load-vehicle-based-pricing',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const pricing =
        getPricing(tenantId, pricingId);

      if (!reason.trim()) {
        throw new AppError(
          'Surcharge reason is required',
          ErrorCode.BAD_REQUEST
        );
      }

      if (!Number.isFinite(amount)) {
        throw new AppError(
          'Surcharge amount must be finite',
          ErrorCode.BAD_REQUEST
        );
      }

      pricing.surcharges.push({
        reason: reason.trim(),
        amount
      });

      const config = ConfigSchema.parse({});

      pricing.totalPrice = calculateTotal(
        pricing.baseRate,
        pricing.distanceMiles,
        pricing.distanceRatePerMile,
        pricing.volumeOrSizeFactor,
        config.volumeFactorRate,
        pricing.surcharges
      );

      pricingStore.set(
        pricing.pricingId,
        pricing
      );

      return pricing;
    },
    auditAction: 'data.updated',
    auditResource: 'load_vehicle_pricing',
    meterEventType: 'api_call'
  });
}

export async function getFinalPrice(
  tenantId: string,
  actorId: string,
  pricingId: string
): Promise<number> {
  return runCrudOperation({
    configName: 'load-vehicle-based-pricing',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      return getPricing(
        tenantId,
        pricingId
      ).totalPrice;
    },
    auditAction: 'data.read',
    auditResource: 'load_vehicle_pricing',
    meterEventType: 'api_call'
  });
}
