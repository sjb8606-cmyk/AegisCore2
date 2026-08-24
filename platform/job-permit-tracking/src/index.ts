import * as crypto from 'crypto';
import { z } from 'zod';
import {
  AppError,
  ErrorCode,
  runCrudOperation
} from '@platform/crud-kernel';

export const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  permitStatuses: z.array(
    z.enum([
      'not_required',
      'pending',
      'pulled',
      'inspection_scheduled',
      'passed',
      'failed'
    ])
  ).default([
    'not_required',
    'pending',
    'pulled',
    'inspection_scheduled',
    'passed',
    'failed'
  ])
});

const PermitStatusSchema = z.enum([
  'not_required',
  'pending',
  'pulled',
  'inspection_scheduled',
  'passed',
  'failed'
]);

export const PermitRecordSchema = z.object({
  permitId: z.string().uuid(),
  tenantId: z.string().uuid(),
  jobId: z.string().uuid(),
  permitType: z.string().min(1).max(200),
  jurisdiction: z.string().min(1).max(300),
  status: PermitStatusSchema,
  permitNumber: z.string().max(200).nullable(),
  issuedDate: z.coerce.date().nullable(),
  expiryDate: z.coerce.date().nullable()
});

export type PermitRecord = z.infer<
  typeof PermitRecordSchema
>;

const permitStore = new Map<
  string,
  PermitRecord
>();

export function __resetJobPermitTrackingStore(): void {
  permitStore.clear();
}

function getPermit(
  tenantId: string,
  permitId: string
): PermitRecord {
  const permit = permitStore.get(permitId);

  if (!permit) {
    throw new AppError(
      'Permit record not found',
      ErrorCode.NOT_FOUND
    );
  }

  if (permit.tenantId !== tenantId) {
    throw new AppError(
      'Resource does not belong to tenant',
      ErrorCode.FORBIDDEN
    );
  }

  return permit;
}

export async function createPermitRecord(
  tenantId: string,
  actorId: string,
  jobId: string,
  permitType: string,
  jurisdiction: string
): Promise<PermitRecord> {
  return runCrudOperation({
    configName: 'job-permit-tracking',
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

      if (!permitType.trim()) {
        throw new AppError(
          'Permit type is required',
          ErrorCode.BAD_REQUEST
        );
      }

      if (!jurisdiction.trim()) {
        throw new AppError(
          'Jurisdiction is required',
          ErrorCode.BAD_REQUEST
        );
      }

      const permit = PermitRecordSchema.parse({
        permitId: crypto.randomUUID(),
        tenantId,
        jobId,
        permitType: permitType.trim(),
        jurisdiction: jurisdiction.trim(),
        status: 'pending',
        permitNumber: null,
        issuedDate: null,
        expiryDate: null
      });

      permitStore.set(
        permit.permitId,
        permit
      );

      return permit;
    },
    auditAction: 'data.created',
    auditResource: 'job_permit_tracking',
    meterEventType: 'api_call'
  });
}

export async function updateStatus(
  tenantId: string,
  actorId: string,
  permitId: string,
  status: PermitRecord['status'],
  permitNumber: string | null = null,
  issuedDate: Date | null = null,
  expiryDate: Date | null = null
): Promise<PermitRecord> {
  return runCrudOperation({
    configName: 'job-permit-tracking',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const permit = getPermit(
        tenantId,
        permitId
      );

      if (
        status === 'pulled' &&
        !permitNumber?.trim()
      ) {
        throw new AppError(
          'Permit number is required when a permit is pulled',
          ErrorCode.BAD_REQUEST
        );
      }

      if (
        issuedDate &&
        Number.isNaN(issuedDate.getTime())
      ) {
        throw new AppError(
          'Invalid issued date',
          ErrorCode.BAD_REQUEST
        );
      }

      if (
        expiryDate &&
        Number.isNaN(expiryDate.getTime())
      ) {
        throw new AppError(
          'Invalid expiry date',
          ErrorCode.BAD_REQUEST
        );
      }

      if (
        issuedDate &&
        expiryDate &&
        expiryDate < issuedDate
      ) {
        throw new AppError(
          'Expiry date cannot precede issued date',
          ErrorCode.BAD_REQUEST
        );
      }

      permit.status = status;

      if (permitNumber !== null) {
        permit.permitNumber =
          permitNumber.trim();
      }

      if (issuedDate !== null) {
        permit.issuedDate = issuedDate;
      }

      if (expiryDate !== null) {
        permit.expiryDate = expiryDate;
      }

      permitStore.set(
        permit.permitId,
        permit
      );

      return permit;
    },
    auditAction: 'data.updated',
    auditResource: 'job_permit_tracking',
    meterEventType: 'api_call'
  });
}

export async function flagExpiringPermits(
  tenantId: string,
  actorId: string,
  daysAhead: number
): Promise<PermitRecord[]> {
  return runCrudOperation({
    configName: 'job-permit-tracking',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (
        !Number.isInteger(daysAhead) ||
        daysAhead < 0
      ) {
        throw new AppError(
          'Days ahead must be a non-negative integer',
          ErrorCode.BAD_REQUEST
        );
      }

      const now = new Date();
      const cutoff = new Date(now);

      cutoff.setDate(
        cutoff.getDate() + daysAhead
      );

      return Array.from(
        permitStore.values()
      ).filter(permit => {
        if (
          permit.tenantId !== tenantId ||
          !permit.expiryDate
        ) {
          return false;
        }

        return (
          permit.expiryDate >= now &&
          permit.expiryDate <= cutoff &&
          permit.status !== 'passed' &&
          permit.status !== 'failed'
        );
      });
    },
    auditAction: 'data.read',
    auditResource: 'job_permit_tracking',
    meterEventType: 'api_call'
  });
}

export async function getPermitRecord(
  tenantId: string,
  actorId: string,
  permitId: string
): Promise<PermitRecord> {
  return runCrudOperation({
    configName: 'job-permit-tracking',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () =>
      getPermit(
        tenantId,
        permitId
      ),
    auditAction: 'data.read',
    auditResource: 'job_permit_tracking',
    meterEventType: 'api_call'
  });
}
