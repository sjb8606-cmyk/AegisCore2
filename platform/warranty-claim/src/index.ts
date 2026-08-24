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

const WarrantyStatusSchema = z.enum([
  'active',
  'expired',
  'unknown'
]);

const ClaimStatusSchema = z.enum([
  'filed',
  'approved',
  'denied',
  'resolved'
]);

export const WarrantyClaimSchema = z.object({
  claimId: z.string().uuid(),
  tenantId: z.string().uuid(),
  jobId: z.string().uuid(),
  equipmentId: z.string().uuid(),
  issueDescription: z.string().min(1).max(10000),
  manufacturerWarrantyStatus: WarrantyStatusSchema,
  claimStatus: ClaimStatusSchema,
  resolutionNotes: z.string().max(10000).nullable()
});

export type WarrantyClaim = z.infer<
  typeof WarrantyClaimSchema
>;

const claimStore = new Map<
  string,
  WarrantyClaim
>();

const warrantyStatusStore = new Map<
  string,
  {
    tenantId: string;
    status: WarrantyClaim['manufacturerWarrantyStatus'];
  }
>();

export function __resetWarrantyClaimStore(): void {
  claimStore.clear();
  warrantyStatusStore.clear();
}

export function __setWarrantyStatus(
  tenantId: string,
  equipmentId: string,
  status: WarrantyClaim['manufacturerWarrantyStatus']
): void {
  warrantyStatusStore.set(
    tenantId + ':' + equipmentId,
    {
      tenantId,
      status
    }
  );
}

function getClaim(
  tenantId: string,
  claimId: string
): WarrantyClaim {
  const claim = claimStore.get(claimId);

  if (!claim) {
    throw new AppError(
      'Warranty claim not found',
      ErrorCode.NOT_FOUND
    );
  }

  if (claim.tenantId !== tenantId) {
    throw new AppError(
      'Resource does not belong to tenant',
      ErrorCode.FORBIDDEN
    );
  }

  return claim;
}

function getWarrantyStatus(
  tenantId: string,
  equipmentId: string
): WarrantyClaim['manufacturerWarrantyStatus'] {
  const record = warrantyStatusStore.get(
    tenantId + ':' + equipmentId
  );

  if (!record) {
    return 'unknown';
  }

  if (record.tenantId !== tenantId) {
    throw new AppError(
      'Resource does not belong to tenant',
      ErrorCode.FORBIDDEN
    );
  }

  return record.status;
}

export async function fileClaim(
  tenantId: string,
  actorId: string,
  jobId: string,
  equipmentId: string,
  issueDescription: string
): Promise<WarrantyClaim> {
  return runCrudOperation({
    configName: 'warranty-claim',
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
        !z.string().uuid().safeParse(equipmentId).success
      ) {
        throw new AppError(
          'Invalid equipment ID',
          ErrorCode.BAD_REQUEST
        );
      }

      if (!issueDescription.trim()) {
        throw new AppError(
          'Issue description is required',
          ErrorCode.BAD_REQUEST
        );
      }

      const claim = WarrantyClaimSchema.parse({
        claimId: crypto.randomUUID(),
        tenantId,
        jobId,
        equipmentId,
        issueDescription: issueDescription.trim(),
        manufacturerWarrantyStatus:
          getWarrantyStatus(
            tenantId,
            equipmentId
          ),
        claimStatus: 'filed',
        resolutionNotes: null
      });

      claimStore.set(
        claim.claimId,
        claim
      );

      return claim;
    },
    auditAction: 'data.created',
    auditResource: 'warranty_claim',
    meterEventType: 'api_call'
  });
}

export async function checkWarrantyStatus(
  tenantId: string,
  actorId: string,
  equipmentId: string
): Promise<WarrantyClaim['manufacturerWarrantyStatus']> {
  return runCrudOperation({
    configName: 'warranty-claim',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (
        !z.string().uuid().safeParse(equipmentId).success
      ) {
        throw new AppError(
          'Invalid equipment ID',
          ErrorCode.BAD_REQUEST
        );
      }

      return getWarrantyStatus(
        tenantId,
        equipmentId
      );
    },
    auditAction: 'data.read',
    auditResource: 'warranty_claim',
    meterEventType: 'api_call'
  });
}

export async function updateClaimStatus(
  tenantId: string,
  actorId: string,
  claimId: string,
  status: WarrantyClaim['claimStatus'],
  notes: string | null = null
): Promise<WarrantyClaim> {
  return runCrudOperation({
    configName: 'warranty-claim',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const claim = getClaim(
        tenantId,
        claimId
      );

      if (
        status === 'resolved' &&
        !notes?.trim()
      ) {
        throw new AppError(
          'Resolution notes are required when resolving a claim',
          ErrorCode.BAD_REQUEST
        );
      }

      claim.claimStatus = status;

      if (notes !== null) {
        claim.resolutionNotes =
          notes.trim();
      }

      claimStore.set(
        claim.claimId,
        claim
      );

      return claim;
    },
    auditAction: 'data.updated',
    auditResource: 'warranty_claim',
    meterEventType: 'api_call'
  });
}
