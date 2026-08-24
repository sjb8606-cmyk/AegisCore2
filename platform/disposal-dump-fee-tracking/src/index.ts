import * as crypto from 'crypto';
import { z } from 'zod';
import {
  AppError,
  ErrorCode,
  runCrudOperation
} from '@platform/crud-kernel';

export const ConfigSchema = z.object({
  enabled: z.boolean().default(true)
});

const DisposalSchema = z.object({
  disposalId: z.string().uuid(),
  tenantId: z.string().uuid(),
  jobId: z.string().uuid(),
  disposalSite: z.string().min(1).max(255),
  wasteCategory: z.enum([
    'general',
    'electronics',
    'hazardous',
    'recyclable',
    'donation'
  ]),
  feeAmount: z.number().nonnegative(),
  weightOrVolume: z.number().nonnegative(),
  createdAt: z.string().datetime()
});

export type Disposal = z.infer<typeof DisposalSchema>;
export type WasteCategory =
  Disposal['wasteCategory'];

const disposalStore = new Map<string, Disposal>();

export function __resetDisposalDumpFeeTrackingStore(): void {
  disposalStore.clear();
}

export function isHazardousWaste(
  wasteCategory: WasteCategory
): boolean {
  return wasteCategory === 'hazardous';
}

export async function logDisposal(
  tenantId: string,
  actorId: string,
  jobId: string,
  disposalSite: string,
  wasteCategory: WasteCategory,
  feeAmount: number,
  weightOrVolume: number
): Promise<Disposal> {
  return runCrudOperation({
    configName: 'disposal-dump-fee-tracking',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!jobId.trim()) {
        throw new AppError(
          'Job ID is required',
          ErrorCode.BAD_REQUEST
        );
      }

      if (!disposalSite.trim()) {
        throw new AppError(
          'Disposal site is required',
          ErrorCode.BAD_REQUEST
        );
      }

      if (
        !Number.isFinite(feeAmount) ||
        feeAmount < 0
      ) {
        throw new AppError(
          'Fee amount must be non-negative',
          ErrorCode.BAD_REQUEST
        );
      }

      if (
        !Number.isFinite(weightOrVolume) ||
        weightOrVolume < 0
      ) {
        throw new AppError(
          'Weight or volume must be non-negative',
          ErrorCode.BAD_REQUEST
        );
      }

      const disposal = DisposalSchema.parse({
        disposalId: crypto.randomUUID(),
        tenantId,
        jobId,
        disposalSite: disposalSite.trim(),
        wasteCategory,
        feeAmount,
        weightOrVolume,
        createdAt: new Date().toISOString()
      });

      disposalStore.set(
        disposal.disposalId,
        disposal
      );

      return disposal;
    },
    auditAction: 'data.created',
    auditResource: 'disposal_dump_fee',
    meterEventType: 'api_call'
  });
}

export async function getDisposalCostTotal(
  tenantId: string,
  actorId: string,
  jobId: string
): Promise<number> {
  return runCrudOperation({
    configName: 'disposal-dump-fee-tracking',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!jobId.trim()) {
        throw new AppError(
          'Job ID is required',
          ErrorCode.BAD_REQUEST
        );
      }

      return Array.from(
        disposalStore.values()
      )
        .filter(
          disposal =>
            disposal.tenantId === tenantId &&
            disposal.jobId === jobId
        )
        .reduce(
          (total, disposal) =>
            total + disposal.feeAmount,
          0
        );
    },
    auditAction: 'data.read',
    auditResource: 'disposal_dump_fee',
    meterEventType: 'api_call'
  });
}

export async function flagHazardousHandlingRequired(
  tenantId: string,
  actorId: string,
  wasteCategory: WasteCategory
): Promise<boolean> {
  return runCrudOperation({
    configName: 'disposal-dump-fee-tracking',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () =>
      isHazardousWaste(wasteCategory),
    auditAction: 'data.read',
    auditResource: 'disposal_dump_fee',
    meterEventType: 'api_call'
  });
}
