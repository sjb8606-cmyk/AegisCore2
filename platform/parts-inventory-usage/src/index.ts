import * as crypto from 'crypto';
import { z } from 'zod';
import {
  AppError,
  ErrorCode,
  runCrudOperation
} from '@platform/crud-kernel';

export const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  sourceLocations: z.array(
    z.enum([
      'van_stock',
      'warehouse',
      'special_order'
    ])
  ).default([
    'van_stock',
    'warehouse',
    'special_order'
  ]),
  reorderThreshold: z.number().nonnegative().default(5)
});

const SourceLocationSchema = z.enum([
  'van_stock',
  'warehouse',
  'special_order'
]);

export const PartUsageSchema = z.object({
  usageId: z.string().uuid(),
  tenantId: z.string().uuid(),
  jobId: z.string().uuid(),
  partSku: z.string().min(1).max(200),
  quantityUsed: z.number().positive(),
  sourceLocation: SourceLocationSchema,
  unitCost: z.number().nonnegative()
});

export type PartUsage = z.infer<
  typeof PartUsageSchema
>;

type StockKey = string;

interface StockRecord {
  tenantId: string;
  partSku: string;
  location: z.infer<typeof SourceLocationSchema>;
  quantity: number;
  reorderPoint: number;
}

const usageStore = new Map<string, PartUsage>();
const stockStore = new Map<StockKey, StockRecord>();

export function __resetPartsInventoryUsageStore(): void {
  usageStore.clear();
  stockStore.clear();
}

export function __setStockLevel(
  record: StockRecord
): void {
  stockStore.set(
    recordKey(
      record.tenantId,
      record.partSku,
      record.location
    ),
    record
  );
}

function recordKey(
  tenantId: string,
  partSku: string,
  location: z.infer<typeof SourceLocationSchema>
): StockKey {
  return (
    tenantId +
    ':' +
    location +
    ':' +
    partSku
  );
}

function getStock(
  tenantId: string,
  partSku: string,
  location: z.infer<typeof SourceLocationSchema>
): StockRecord {
  const stock = stockStore.get(
    recordKey(
      tenantId,
      partSku,
      location
    )
  );

  if (!stock) {
    throw new AppError(
      'Stock record not found',
      ErrorCode.NOT_FOUND
    );
  }

  if (stock.tenantId !== tenantId) {
    throw new AppError(
      'Resource does not belong to tenant',
      ErrorCode.FORBIDDEN
    );
  }

  return stock;
}

export async function logPartUsage(
  tenantId: string,
  actorId: string,
  jobId: string,
  partSku: string,
  quantity: number,
  sourceLocation: PartUsage['sourceLocation'],
  unitCost: number
): Promise<PartUsage> {
  return runCrudOperation({
    configName: 'parts-inventory-usage',
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

      if (!partSku.trim()) {
        throw new AppError(
          'Part SKU is required',
          ErrorCode.BAD_REQUEST
        );
      }

      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new AppError(
          'Quantity must be greater than zero',
          ErrorCode.BAD_REQUEST
        );
      }

      if (!Number.isFinite(unitCost) || unitCost < 0) {
        throw new AppError(
          'Unit cost cannot be negative',
          ErrorCode.BAD_REQUEST
        );
      }

      const stock = getStock(
        tenantId,
        partSku.trim(),
        sourceLocation
      );

      if (stock.quantity < quantity) {
        throw new AppError(
          'Insufficient stock',
          ErrorCode.CONFLICT
        );
      }

      stock.quantity -= quantity;

      const usage = PartUsageSchema.parse({
        usageId: crypto.randomUUID(),
        tenantId,
        jobId,
        partSku: partSku.trim(),
        quantityUsed: quantity,
        sourceLocation,
        unitCost
      });

      usageStore.set(
        usage.usageId,
        usage
      );

      return usage;
    },
    auditAction: 'data.created',
    auditResource: 'parts_inventory_usage',
    meterEventType: 'api_call'
  });
}

export async function getStockLevel(
  tenantId: string,
  actorId: string,
  partSku: string,
  location: PartUsage['sourceLocation']
): Promise<number> {
  return runCrudOperation({
    configName: 'parts-inventory-usage',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!partSku.trim()) {
        throw new AppError(
          'Part SKU is required',
          ErrorCode.BAD_REQUEST
        );
      }

      return getStock(
        tenantId,
        partSku.trim(),
        location
      ).quantity;
    },
    auditAction: 'data.read',
    auditResource: 'parts_inventory_usage',
    meterEventType: 'api_call'
  });
}

export async function triggerReorder(
  tenantId: string,
  actorId: string,
  partSku: string,
  location: PartUsage['sourceLocation']
): Promise<boolean> {
  return runCrudOperation({
    configName: 'parts-inventory-usage',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const stock = getStock(
        tenantId,
        partSku.trim(),
        location
      );

      return stock.quantity <= stock.reorderPoint;
    },
    auditAction: 'data.read',
    auditResource: 'parts_inventory_usage',
    meterEventType: 'api_call'
  });
}
