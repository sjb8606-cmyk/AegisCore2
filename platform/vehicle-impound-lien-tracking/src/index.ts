import * as crypto from 'crypto';
import { z } from 'zod';
import {
  AppError,
  ErrorCode,
  runCrudOperation
} from '@platform/crud-kernel';

export const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  defaultReleaseWindowDays: z.number().int().nonnegative().default(30)
});

const ImpoundSchema = z.object({
  impoundId: z.string().uuid(),
  tenantId: z.string().uuid(),
  vehicleVin: z.string().min(1).max(17),
  licensePlate: z.string().min(1).max(32).optional(),
  impoundDate: z.string().datetime(),
  reason: z.enum([
    'abandoned',
    'accident',
    'police_hold',
    'non_payment'
  ]),
  lienFiledDate: z.string().datetime().optional(),
  releaseEligibleDate: z.string().datetime(),
  status: z.enum([
    'held',
    'released',
    'auctioned'
  ]),
  releasedTo: z.string().max(255).optional()
});

export type Impound = z.infer<typeof ImpoundSchema>;

const impoundStore = new Map<string, Impound>();

export function __resetVehicleImpoundLienTrackingStore(): void {
  impoundStore.clear();
}

function getImpound(
  tenantId: string,
  impoundId: string
): Impound {
  const impound = impoundStore.get(impoundId);

  if (!impound) {
    throw new AppError(
      'Impound record not found',
      ErrorCode.NOT_FOUND
    );
  }

  if (impound.tenantId !== tenantId) {
    throw new AppError(
      'Resource does not belong to tenant',
      ErrorCode.FORBIDDEN
    );
  }

  return impound;
}

export async function logImpound(
  tenantId: string,
  actorId: string,
  vehicleVin: string,
  reason: Impound['reason'],
  licensePlate?: string
): Promise<Impound> {
  return runCrudOperation({
    configName: 'vehicle-impound-lien-tracking',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const normalizedVin = vehicleVin.trim().toUpperCase();

      if (
        normalizedVin.length < 1 ||
        normalizedVin.length > 17
      ) {
        throw new AppError(
          'Invalid vehicle VIN',
          ErrorCode.BAD_REQUEST
        );
      }

      const existing = Array.from(
        impoundStore.values()
      ).find(
        impound =>
          impound.tenantId === tenantId &&
          impound.vehicleVin === normalizedVin &&
          impound.status === 'held'
      );

      if (existing) {
        throw new AppError(
          'Vehicle already has an active impound record',
          ErrorCode.CONFLICT
        );
      }

      const now = new Date();
      const config = ConfigSchema.parse({});

      const releaseDate = new Date(now);
      releaseDate.setDate(
        releaseDate.getDate() +
        config.defaultReleaseWindowDays
      );

      const impound = ImpoundSchema.parse({
        impoundId: crypto.randomUUID(),
        tenantId,
        vehicleVin: normalizedVin,
        licensePlate: licensePlate
          ? licensePlate.trim().toUpperCase()
          : undefined,
        impoundDate: now.toISOString(),
        reason,
        releaseEligibleDate:
          releaseDate.toISOString(),
        status: 'held'
      });

      impoundStore.set(
        impound.impoundId,
        impound
      );

      return impound;
    },
    auditAction: 'data.created',
    auditResource: 'vehicle_impound_lien',
    meterEventType: 'api_call'
  });
}

export async function fileLien(
  tenantId: string,
  actorId: string,
  impoundId: string,
  lienDate: string
): Promise<Impound> {
  return runCrudOperation({
    configName: 'vehicle-impound-lien-tracking',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const parsedDate = new Date(lienDate);

      if (Number.isNaN(parsedDate.getTime())) {
        throw new AppError(
          'Invalid lien date',
          ErrorCode.BAD_REQUEST
        );
      }

      const impound = getImpound(
        tenantId,
        impoundId
      );

      if (impound.status !== 'held') {
        throw new AppError(
          'Lien cannot be filed on a released or auctioned vehicle',
          ErrorCode.CONFLICT
        );
      }

      impound.lienFiledDate =
        parsedDate.toISOString();

      impoundStore.set(
        impound.impoundId,
        impound
      );

      return impound;
    },
    auditAction: 'data.updated',
    auditResource: 'vehicle_impound_lien',
    meterEventType: 'api_call'
  });
}

export async function checkReleaseEligibility(
  tenantId: string,
  actorId: string,
  impoundId: string
): Promise<boolean> {
  return runCrudOperation({
    configName: 'vehicle-impound-lien-tracking',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const impound = getImpound(
        tenantId,
        impoundId
      );

      if (impound.status !== 'held') {
        return false;
      }

      return Date.now() >=
        new Date(
          impound.releaseEligibleDate
        ).getTime();
    },
    auditAction: 'data.read',
    auditResource: 'vehicle_impound_lien',
    meterEventType: 'api_call'
  });
}

export async function releaseVehicle(
  tenantId: string,
  actorId: string,
  impoundId: string,
  releasedTo: string
): Promise<Impound> {
  return runCrudOperation({
    configName: 'vehicle-impound-lien-tracking',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!releasedTo.trim()) {
        throw new AppError(
          'Release recipient is required',
          ErrorCode.BAD_REQUEST
        );
      }

      const impound = getImpound(
        tenantId,
        impoundId
      );

      if (impound.status !== 'held') {
        throw new AppError(
          'Vehicle is no longer held',
          ErrorCode.CONFLICT
        );
      }

      if (
        Date.now() <
        new Date(
          impound.releaseEligibleDate
        ).getTime()
      ) {
        throw new AppError(
          'Vehicle is not yet eligible for release',
          ErrorCode.CONFLICT
        );
      }

      impound.status = 'released';
      impound.releasedTo =
        releasedTo.trim();

      impoundStore.set(
        impound.impoundId,
        impound
      );

      return impound;
    },
    auditAction: 'data.updated',
    auditResource: 'vehicle_impound_lien',
    meterEventType: 'api_call'
  });
}
