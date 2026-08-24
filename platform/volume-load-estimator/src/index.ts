import * as crypto from 'crypto';
import { z } from 'zod';
import {
  AppError,
  ErrorCode,
  runCrudOperation
} from '@platform/crud-kernel';

export const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  defaultEstimatedCubicYards: z.number().positive().default(1)
});

const EstimateSchema = z.object({
  estimateId: z.string().uuid(),
  tenantId: z.string().uuid(),
  requestId: z.string().uuid(),
  photos: z.array(z.string().min(1)),
  estimatedCubicYards: z.number().nonnegative(),
  finalCubicYards: z.number().nonnegative().optional(),
  priceVariance: z.number().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export type VolumeEstimate = z.infer<
  typeof EstimateSchema
>;

const estimateStore = new Map<string, VolumeEstimate>();

export function __resetVolumeLoadEstimatorStore(): void {
  estimateStore.clear();
}

export async function estimateFromPhotos(
  tenantId: string,
  actorId: string,
  requestId: string,
  photos: string[]
): Promise<VolumeEstimate> {
  return runCrudOperation({
    configName: 'volume-load-estimator',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!requestId.trim()) {
        throw new AppError(
          'Request ID is required',
          ErrorCode.BAD_REQUEST
        );
      }

      if (photos.length === 0) {
        throw new AppError(
          'At least one photo is required',
          ErrorCode.BAD_REQUEST
        );
      }

      const config = ConfigSchema.parse({});
      const now = new Date().toISOString();

      const estimate = EstimateSchema.parse({
        estimateId: crypto.randomUUID(),
        tenantId,
        requestId,
        photos,
        estimatedCubicYards:
          config.defaultEstimatedCubicYards,
        createdAt: now,
        updatedAt: now
      });

      estimateStore.set(
        estimate.estimateId,
        estimate
      );

      return estimate;
    },
    auditAction: 'data.created',
    auditResource: 'volume_load_estimate',
    meterEventType: 'api_call'
  });
}

export async function confirmFinalVolume(
  tenantId: string,
  actorId: string,
  estimateId: string,
  finalCubicYards: number
): Promise<VolumeEstimate> {
  return runCrudOperation({
    configName: 'volume-load-estimator',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (
        !Number.isFinite(finalCubicYards) ||
        finalCubicYards < 0
      ) {
        throw new AppError(
          'Final volume must be non-negative',
          ErrorCode.BAD_REQUEST
        );
      }

      const estimate =
        estimateStore.get(estimateId);

      if (!estimate) {
        throw new AppError(
          'Volume estimate not found',
          ErrorCode.NOT_FOUND
        );
      }

      if (estimate.tenantId !== tenantId) {
        throw new AppError(
          'Resource does not belong to tenant',
          ErrorCode.FORBIDDEN
        );
      }

      estimate.finalCubicYards =
        finalCubicYards;
      estimate.priceVariance =
        calculateVariance(
          estimate.estimatedCubicYards,
          finalCubicYards
        );
      estimate.updatedAt =
        new Date().toISOString();

      estimateStore.set(
        estimateId,
        estimate
      );

      return estimate;
    },
    auditAction: 'data.updated',
    auditResource: 'volume_load_estimate',
    meterEventType: 'api_call'
  });
}

export function calculateVariance(
  estimatedCubicYards: number,
  finalCubicYards: number
): number {
  if (
    !Number.isFinite(estimatedCubicYards) ||
    estimatedCubicYards < 0 ||
    !Number.isFinite(finalCubicYards) ||
    finalCubicYards < 0
  ) {
    throw new AppError(
      'Volume values must be non-negative',
      ErrorCode.BAD_REQUEST
    );
  }

  return finalCubicYards -
    estimatedCubicYards;
}

export async function calculatePriceVariance(
  tenantId: string,
  actorId: string,
  estimateId: string
): Promise<number> {
  return runCrudOperation({
    configName: 'volume-load-estimator',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const estimate =
        estimateStore.get(estimateId);

      if (!estimate) {
        throw new AppError(
          'Volume estimate not found',
          ErrorCode.NOT_FOUND
        );
      }

      if (estimate.tenantId !== tenantId) {
        throw new AppError(
          'Resource does not belong to tenant',
          ErrorCode.FORBIDDEN
        );
      }

      if (
        estimate.finalCubicYards ===
        undefined
      ) {
        throw new AppError(
          'Final volume has not been confirmed',
          ErrorCode.CONFLICT
        );
      }

      return calculateVariance(
        estimate.estimatedCubicYards,
        estimate.finalCubicYards
      );
    },
    auditAction: 'data.read',
    auditResource: 'volume_load_estimate',
    meterEventType: 'api_call'
  });
}
