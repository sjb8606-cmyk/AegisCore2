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

const AssetSchema = z.object({
  assetId: z.string().uuid(),
  tenantId: z.string().uuid(),
  sku: z.string().min(1),
  serialNumber: z.string().min(1),
  condition: z.enum([
    'excellent',
    'good',
    'fair',
    'needs_repair'
  ]),
  currentStatus: z.enum([
    'available',
    'rented',
    'in_maintenance',
    'retired'
  ]),
  purchaseDate: z.string().datetime(),
  currentLocation: z.string().min(1)
});

export type SerializedAsset = z.infer<typeof AssetSchema>;

const assetStore = new Map<string, SerializedAsset>();

export function __resetSerializedAssetInventoryStore(): void {
  assetStore.clear();
}

export async function registerAsset(
  tenantId: string,
  actorId: string,
  sku: string,
  serialNumber: string,
  purchaseDate: string,
  currentLocation: string,
  condition: SerializedAsset['condition'] = 'excellent'
): Promise<SerializedAsset> {
  return runCrudOperation({
    configName: 'serialized-asset-inventory',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const duplicate = Array.from(assetStore.values()).find(
        (asset) =>
          asset.tenantId === tenantId &&
          asset.serialNumber === serialNumber
      );

      if (duplicate) {
        throw new AppError(
          'Serial number already exists',
          ErrorCode.CONFLICT
        );
      }

      const asset = AssetSchema.parse({
        assetId: crypto.randomUUID(),
        tenantId,
        sku,
        serialNumber,
        condition,
        currentStatus: 'available',
        purchaseDate,
        currentLocation
      });

      assetStore.set(asset.assetId, asset);
      return asset;
    },
    auditAction: 'data.created',
    auditResource: 'serialized_asset',
    meterEventType: 'api_call'
  });
}

export async function updateCondition(
  tenantId: string,
  actorId: string,
  assetId: string,
  condition: SerializedAsset['condition'],
  notes?: string
): Promise<SerializedAsset> {
  return runCrudOperation({
    configName: 'serialized-asset-inventory',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const asset = assetStore.get(assetId);

      if (!asset || asset.tenantId !== tenantId) {
        throw new AppError(
          'Asset not found',
          ErrorCode.NOT_FOUND
        );
      }

      const updated = {
        ...asset,
        condition,
        ...(notes !== undefined ? { notes } : {})
      };

      assetStore.set(assetId, updated as SerializedAsset);
      return updated as SerializedAsset;
    },
    auditAction: 'data.updated',
    auditResource: 'serialized_asset',
    meterEventType: 'api_call'
  });
}

export async function getAvailableAssets(
  tenantId: string,
  actorId: string,
  sku: string,
  startDate: string,
  endDate: string
): Promise<SerializedAsset[]> {
  return runCrudOperation({
    configName: 'serialized-asset-inventory',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (
        Number.isNaN(new Date(startDate).getTime()) ||
        Number.isNaN(new Date(endDate).getTime()) ||
        new Date(startDate) > new Date(endDate)
      ) {
        throw new AppError(
          'Invalid date range',
          ErrorCode.BAD_REQUEST
        );
      }

      return Array.from(assetStore.values()).filter(
        (asset) =>
          asset.tenantId === tenantId &&
          asset.sku === sku &&
          asset.currentStatus === 'available'
      );
    },
    auditAction: 'data.read',
    auditResource: 'serialized_asset',
    meterEventType: 'api_call'
  });
}
