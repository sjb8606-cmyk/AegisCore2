import * as crypto from 'crypto';
import { z } from 'zod';
import {
  AppError,
  ErrorCode,
  runCrudOperation
} from '@platform/crud-kernel';

export const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  defaultUpsellThreshold: z.number().int().nonnegative().default(3)
});

export const SeasonalServicePackageSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string().min(1).max(500),
  includedVisits: z.number().int().positive(),
  visitsUsed: z.number().int().nonnegative(),
  expiryDate: z.coerce.date(),
  upsellThreshold: z.number().int().nonnegative()
});

export type SeasonalServicePackage = z.infer<
  typeof SeasonalServicePackageSchema
>;

const packageStore = new Map<string, SeasonalServicePackage>();

export function __resetSeasonalServicePackageStore(): void {
  packageStore.clear();
}

function getPackage(
  tenantId: string,
  packageId: string
): SeasonalServicePackage {
  const servicePackage = packageStore.get(packageId);

  if (!servicePackage) {
    throw new AppError(
      'Seasonal service package not found',
      ErrorCode.NOT_FOUND
    );
  }

  if (servicePackage.tenantId !== tenantId) {
    throw new AppError(
      'Resource does not belong to tenant',
      ErrorCode.FORBIDDEN
    );
  }

  return servicePackage;
}

export async function createPackage(
  tenantId: string,
  actorId: string,
  input: Omit<SeasonalServicePackage, 'id' | 'tenantId'>
): Promise<SeasonalServicePackage> {
  return runCrudOperation({
    configName: 'seasonal-service-package',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (input.visitsUsed > input.includedVisits) {
        throw new AppError(
          'Visits used cannot exceed included visits',
          ErrorCode.BAD_REQUEST
        );
      }

      const servicePackage = SeasonalServicePackageSchema.parse({
        id: crypto.randomUUID(),
        tenantId,
        ...input
      });

      packageStore.set(servicePackage.id, servicePackage);

      return servicePackage;
    },
    auditAction: 'data.created',
    auditResource: 'seasonal_service_package',
    meterEventType: 'api_call'
  });
}

export async function deductVisit(
  tenantId: string,
  actorId: string,
  packageId: string
): Promise<SeasonalServicePackage> {
  return runCrudOperation({
    configName: 'seasonal-service-package',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const servicePackage = getPackage(tenantId, packageId);

      if (new Date() > servicePackage.expiryDate) {
        throw new AppError(
          'Seasonal service package has expired',
          ErrorCode.CONFLICT
        );
      }

      if (servicePackage.visitsUsed >= servicePackage.includedVisits) {
        throw new AppError(
          'No visits remaining in package',
          ErrorCode.CONFLICT
        );
      }

      servicePackage.visitsUsed += 1;
      packageStore.set(servicePackage.id, servicePackage);

      return servicePackage;
    },
    auditAction: 'data.updated',
    auditResource: 'seasonal_service_package',
    meterEventType: 'api_call'
  });
}

export async function getRemainingVisits(
  tenantId: string,
  actorId: string,
  packageId: string
): Promise<number> {
  return runCrudOperation({
    configName: 'seasonal-service-package',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const servicePackage = getPackage(tenantId, packageId);

      return Math.max(
        0,
        servicePackage.includedVisits -
          servicePackage.visitsUsed
      );
    },
    auditAction: 'data.read',
    auditResource: 'seasonal_service_package',
    meterEventType: 'api_call'
  });
}

export async function checkUpsellTrigger(
  tenantId: string,
  actorId: string,
  packageId: string
): Promise<boolean> {
  return runCrudOperation({
    configName: 'seasonal-service-package',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const servicePackage = getPackage(tenantId, packageId);

      const remaining =
        servicePackage.includedVisits -
        servicePackage.visitsUsed;

      return remaining <= servicePackage.upsellThreshold;
    },
    auditAction: 'data.read',
    auditResource: 'seasonal_service_package',
    meterEventType: 'api_call'
  });
}

export async function getPackageById(
  tenantId: string,
  actorId: string,
  packageId: string
): Promise<SeasonalServicePackage> {
  return runCrudOperation({
    configName: 'seasonal-service-package',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => getPackage(tenantId, packageId),
    auditAction: 'data.read',
    auditResource: 'seasonal_service_package',
    meterEventType: 'api_call'
  });
}
