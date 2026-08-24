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

export const ApplianceSchema = z.object({
  applianceId: z.string().uuid(),
  tenantId: z.string().uuid(),
  clientId: z.string().uuid(),
  applianceType: z.enum([
    'refrigerator',
    'washer',
    'dryer',
    'dishwasher',
    'oven',
    'range',
    'other'
  ]),
  manufacturer: z.string().min(1).max(200),
  modelNumber: z.string().min(1).max(200),
  serialNumber: z.string().min(1).max(200),
  purchaseDate: z.string().date().nullable(),
  warrantyExpiryDate: z.string().date().nullable(),
  createdAt: z.string().datetime()
});

export type Appliance = z.infer<typeof ApplianceSchema>;

const applianceStore = new Map<string, Appliance>();

export function __resetApplianceRegistryStore(): void {
  applianceStore.clear();
}

export async function registerAppliance(
  tenantId: string,
  actorId: string,
  clientId: string,
  applianceData: {
    applianceType: Appliance['applianceType'];
    manufacturer: string;
    modelNumber: string;
    serialNumber: string;
    purchaseDate?: string | null;
    warrantyExpiryDate?: string | null;
  }
): Promise<Appliance> {
  return runCrudOperation({
    configName: 'appliance-registry',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!clientId.trim()) {
        throw new AppError(
          'Client ID is required',
          ErrorCode.BAD_REQUEST
        );
      }

      const appliance = ApplianceSchema.parse({
        applianceId: crypto.randomUUID(),
        tenantId,
        clientId,
        applianceType: applianceData.applianceType,
        manufacturer: applianceData.manufacturer.trim(),
        modelNumber: applianceData.modelNumber.trim(),
        serialNumber: applianceData.serialNumber.trim(),
        purchaseDate: applianceData.purchaseDate ?? null,
        warrantyExpiryDate:
          applianceData.warrantyExpiryDate ?? null,
        createdAt: new Date().toISOString()
      });

      applianceStore.set(
        appliance.applianceId,
        appliance
      );

      return appliance;
    },
    auditAction: 'data.created',
    auditResource: 'appliance',
    meterEventType: 'api_call'
  });
}

export async function getApplianceHistory(
  tenantId: string,
  actorId: string,
  applianceId: string
): Promise<Appliance> {
  return runCrudOperation({
    configName: 'appliance-registry',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const appliance =
        applianceStore.get(applianceId);

      if (!appliance) {
        throw new AppError(
          'Appliance not found',
          ErrorCode.NOT_FOUND
        );
      }

      if (appliance.tenantId !== tenantId) {
        throw new AppError(
          'Appliance does not belong to tenant',
          ErrorCode.FORBIDDEN
        );
      }

      return appliance;
    },
    auditAction: 'data.read',
    auditResource: 'appliance',
    meterEventType: 'api_call'
  });
}

export async function checkWarrantyStatus(
  tenantId: string,
  actorId: string,
  applianceId: string
): Promise<'active' | 'expired' | 'unknown'> {
  return runCrudOperation({
    configName: 'appliance-registry',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const appliance =
        applianceStore.get(applianceId);

      if (!appliance) {
        throw new AppError(
          'Appliance not found',
          ErrorCode.NOT_FOUND
        );
      }

      if (appliance.tenantId !== tenantId) {
        throw new AppError(
          'Appliance does not belong to tenant',
          ErrorCode.FORBIDDEN
        );
      }

      if (!appliance.warrantyExpiryDate) {
        return 'unknown';
      }

      return appliance.warrantyExpiryDate >=
        new Date().toISOString().slice(0, 10)
        ? 'active'
        : 'expired';
    },
    auditAction: 'data.read',
    auditResource: 'appliance_warranty',
    meterEventType: 'api_call'
  });
}
