/**
 * platform/retail-backbar-inventory (SAL-04)
 *
 * Dual-bin inventory: retail (for sale) vs backbar (used in services).
 * Usage per ticket + shrink logging.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('retail-backbar-inventory');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  allowNegative: z.boolean().default(false),
  lowStockThreshold: z.number().int().nonnegative().default(5),
});

export type BinType = 'retail' | 'backbar';

export interface SalonSku {
  id: string;
  tenantId: string;
  skuCode: string;
  name: string;
  retailQty: number;
  backbarQty: number;
  unitCostCents: number;
  active: boolean;
}

export interface UsageEvent {
  id: string;
  tenantId: string;
  skuId: string;
  bin: BinType;
  quantity: number;
  visitId: string | null;
  reason: 'service_use' | 'sale' | 'shrink' | 'transfer' | 'receive';
  createdAt: string;
  actorId: string;
}

const skus = new Map<string, SalonSku>();
const events = new Map<string, UsageEvent>();

export function __resetRetailBackbarStore(): void {
  skus.clear();
  events.clear();
}

function findSku(tenantId: string, skuId: string): SalonSku {
  const sku = skus.get(skuId);
  if (!sku || sku.tenantId !== tenantId) {
    throw new AppError('SKU not found', ErrorCode.NOT_FOUND);
  }
  return sku;
}

export async function createSalonSku(
  tenantId: string,
  actorId: string,
  input: {
    skuCode: string;
    name: string;
    retailQty?: number;
    backbarQty?: number;
    unitCostCents?: number;
  },
): Promise<SalonSku> {
  return runCrudOperation({
    configName: 'retail-backbar-inventory',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!input.skuCode?.trim() || !input.name?.trim()) {
        throw new AppError('skuCode and name required', ErrorCode.BAD_REQUEST);
      }
      const dup = [...skus.values()].find(
        (s) => s.tenantId === tenantId && s.skuCode === input.skuCode.trim(),
      );
      if (dup) {
        throw new AppError('skuCode already exists', ErrorCode.CONFLICT);
      }
      const sku: SalonSku = {
        id: crypto.randomUUID(),
        tenantId,
        skuCode: input.skuCode.trim(),
        name: input.name.trim(),
        retailQty: input.retailQty ?? 0,
        backbarQty: input.backbarQty ?? 0,
        unitCostCents: input.unitCostCents ?? 0,
        active: true,
      };
      skus.set(sku.id, sku);
      return sku;
    },
    auditAction: 'data.created',
    auditResource: 'salon_sku',
    meterEventType: 'api_call',
  });
}

export async function receiveStock(
  tenantId: string,
  actorId: string,
  input: { skuId: string; bin: BinType; quantity: number },
): Promise<SalonSku> {
  return runCrudOperation({
    configName: 'retail-backbar-inventory',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!['retail', 'backbar'].includes(input.bin)) {
        throw new AppError('invalid bin', ErrorCode.BAD_REQUEST);
      }
      if (typeof input.quantity !== 'number' || input.quantity <= 0) {
        throw new AppError('quantity must be positive', ErrorCode.BAD_REQUEST);
      }
      const sku = findSku(tenantId, input.skuId);
      if (input.bin === 'retail') sku.retailQty += input.quantity;
      else sku.backbarQty += input.quantity;
      skus.set(sku.id, sku);
      const ev: UsageEvent = {
        id: crypto.randomUUID(),
        tenantId,
        skuId: sku.id,
        bin: input.bin,
        quantity: input.quantity,
        visitId: null,
        reason: 'receive',
        createdAt: new Date().toISOString(),
        actorId,
      };
      events.set(ev.id, ev);
      return sku;
    },
    auditAction: 'data.updated',
    auditResource: 'salon_sku',
    meterEventType: 'api_call',
  });
}

export async function transferBin(
  tenantId: string,
  actorId: string,
  input: { skuId: string; fromBin: BinType; toBin: BinType; quantity: number },
): Promise<SalonSku> {
  return runCrudOperation({
    configName: 'retail-backbar-inventory',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('retail-backbar-inventory', ConfigSchema);
      if (input.fromBin === input.toBin) {
        throw new AppError('fromBin and toBin must differ', ErrorCode.BAD_REQUEST);
      }
      if (input.quantity <= 0) {
        throw new AppError('quantity must be positive', ErrorCode.BAD_REQUEST);
      }
      const sku = findSku(tenantId, input.skuId);
      const fromQty = input.fromBin === 'retail' ? sku.retailQty : sku.backbarQty;
      if (fromQty < input.quantity && !config.allowNegative) {
        throw new AppError('insufficient stock', ErrorCode.CONFLICT);
      }
      if (input.fromBin === 'retail') sku.retailQty -= input.quantity;
      else sku.backbarQty -= input.quantity;
      if (input.toBin === 'retail') sku.retailQty += input.quantity;
      else sku.backbarQty += input.quantity;
      skus.set(sku.id, sku);
      const ev: UsageEvent = {
        id: crypto.randomUUID(),
        tenantId,
        skuId: sku.id,
        bin: input.toBin,
        quantity: input.quantity,
        visitId: null,
        reason: 'transfer',
        createdAt: new Date().toISOString(),
        actorId,
      };
      events.set(ev.id, ev);
      return sku;
    },
    auditAction: 'data.updated',
    auditResource: 'salon_sku',
    meterEventType: 'api_call',
  });
}

export async function consumeBackbar(
  tenantId: string,
  actorId: string,
  input: { skuId: string; quantity: number; visitId?: string },
): Promise<SalonSku> {
  return runCrudOperation({
    configName: 'retail-backbar-inventory',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('retail-backbar-inventory', ConfigSchema);
      if (input.quantity <= 0) {
        throw new AppError('quantity must be positive', ErrorCode.BAD_REQUEST);
      }
      const sku = findSku(tenantId, input.skuId);
      if (sku.backbarQty < input.quantity && !config.allowNegative) {
        throw new AppError('insufficient backbar stock', ErrorCode.CONFLICT);
      }
      sku.backbarQty -= input.quantity;
      skus.set(sku.id, sku);
      const ev: UsageEvent = {
        id: crypto.randomUUID(),
        tenantId,
        skuId: sku.id,
        bin: 'backbar',
        quantity: input.quantity,
        visitId: input.visitId || null,
        reason: 'service_use',
        createdAt: new Date().toISOString(),
        actorId,
      };
      events.set(ev.id, ev);
      return sku;
    },
    auditAction: 'data.updated',
    auditResource: 'salon_sku',
    meterEventType: 'api_call',
  });
}

export async function sellRetail(
  tenantId: string,
  actorId: string,
  input: { skuId: string; quantity: number; visitId?: string },
): Promise<SalonSku> {
  return runCrudOperation({
    configName: 'retail-backbar-inventory',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('retail-backbar-inventory', ConfigSchema);
      if (input.quantity <= 0) {
        throw new AppError('quantity must be positive', ErrorCode.BAD_REQUEST);
      }
      const sku = findSku(tenantId, input.skuId);
      if (sku.retailQty < input.quantity && !config.allowNegative) {
        throw new AppError('insufficient retail stock', ErrorCode.CONFLICT);
      }
      sku.retailQty -= input.quantity;
      skus.set(sku.id, sku);
      const ev: UsageEvent = {
        id: crypto.randomUUID(),
        tenantId,
        skuId: sku.id,
        bin: 'retail',
        quantity: input.quantity,
        visitId: input.visitId || null,
        reason: 'sale',
        createdAt: new Date().toISOString(),
        actorId,
      };
      events.set(ev.id, ev);
      return sku;
    },
    auditAction: 'data.updated',
    auditResource: 'salon_sku',
    meterEventType: 'api_call',
  });
}

export async function logShrink(
  tenantId: string,
  actorId: string,
  input: { skuId: string; bin: BinType; quantity: number },
): Promise<SalonSku> {
  return runCrudOperation({
    configName: 'retail-backbar-inventory',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (input.quantity <= 0) {
        throw new AppError('quantity must be positive', ErrorCode.BAD_REQUEST);
      }
      const sku = findSku(tenantId, input.skuId);
      if (input.bin === 'retail') sku.retailQty = Math.max(0, sku.retailQty - input.quantity);
      else sku.backbarQty = Math.max(0, sku.backbarQty - input.quantity);
      skus.set(sku.id, sku);
      const ev: UsageEvent = {
        id: crypto.randomUUID(),
        tenantId,
        skuId: sku.id,
        bin: input.bin,
        quantity: input.quantity,
        visitId: null,
        reason: 'shrink',
        createdAt: new Date().toISOString(),
        actorId,
      };
      events.set(ev.id, ev);
      logger.warn({ skuId: sku.id, qty: input.quantity }, 'Shrink logged');
      return sku;
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'salon_sku',
    meterEventType: 'api_call',
  });
}

export async function listLowStock(
  tenantId: string,
  actorId: string,
): Promise<SalonSku[]> {
  return runCrudOperation({
    configName: 'retail-backbar-inventory',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('retail-backbar-inventory', ConfigSchema);
      return [...skus.values()].filter(
        (s) =>
          s.tenantId === tenantId &&
          s.active &&
          (s.retailQty <= config.lowStockThreshold ||
            s.backbarQty <= config.lowStockThreshold),
      );
    },
    auditAction: 'data.read',
    auditResource: 'salon_sku',
    meterEventType: 'api_call',
  });
}
