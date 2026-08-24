/**
 * platform/ag-sales-yield (AG-06)
 *
 * Simple sales logging + gross margin + yield-per-acre summary.
 * Not a full accounting system — connects AG-02 harvest lots to basic margin view.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('ag-sales-yield');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  defaultLaborCostPerCycle: z.number().nonnegative().default(0),
});

export interface Sale {
  id: string;
  tenantId: string;
  harvestLotId: string;
  cropCycleId: string | null;
  fieldId: string | null;
  buyerName: string;
  quantitySold: number;
  pricePerUnit: number;
  totalRevenue: number;
  soldAt: string;
  actorId: string;
}

export interface CycleCostHint {
  cropCycleId: string;
  inputCost: number;
  laborCost: number;
  acres: number;
  yieldKg: number;
}

const sales = new Map<string, Sale>();
/** Optional cost hints injected from AG-03 / ops */
const costHints = new Map<string, CycleCostHint>(); // cropCycleId

export function __resetAgSalesYieldStore(): void {
  sales.clear();
  costHints.clear();
}

export function setCycleCostHint(hint: CycleCostHint): void {
  costHints.set(hint.cropCycleId, hint);
}

async function loadCfg() {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('ag-sales-yield', ConfigSchema);
}

export async function recordSale(
  tenantId: string,
  actorId: string,
  input: {
    harvestLotId: string;
    buyerName: string;
    quantitySold: number;
    pricePerUnit: number;
    cropCycleId?: string;
    fieldId?: string;
  },
): Promise<Sale> {
  return runCrudOperation({
    configName: 'ag-sales-yield',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!input.harvestLotId?.trim() || !input.buyerName?.trim()) {
        throw new AppError(
          'harvestLotId and buyerName required',
          ErrorCode.BAD_REQUEST,
        );
      }
      if (
        typeof input.quantitySold !== 'number' ||
        input.quantitySold <= 0 ||
        typeof input.pricePerUnit !== 'number' ||
        input.pricePerUnit < 0
      ) {
        throw new AppError(
          'quantitySold must be > 0 and pricePerUnit >= 0',
          ErrorCode.BAD_REQUEST,
        );
      }
      const totalRevenue =
        Math.round(input.quantitySold * input.pricePerUnit * 100) / 100;
      const sale: Sale = {
        id: crypto.randomUUID(),
        tenantId,
        harvestLotId: input.harvestLotId,
        cropCycleId: input.cropCycleId || null,
        fieldId: input.fieldId || null,
        buyerName: input.buyerName.trim(),
        quantitySold: input.quantitySold,
        pricePerUnit: input.pricePerUnit,
        totalRevenue,
        soldAt: new Date().toISOString(),
        actorId,
      };
      sales.set(sale.id, sale);
      logger.info(
        { saleId: sale.id, revenue: totalRevenue },
        'Sale recorded',
      );
      return sale;
    },
    auditAction: 'data.created',
    auditResource: 'ag_sale',
    meterEventType: 'api_call',
  });
}

export async function calculateGrossMargin(
  tenantId: string,
  cropCycleId: string,
): Promise<{
  cropCycleId: string;
  totalSales: number;
  inputCosts: number;
  laborCosts: number;
  grossMargin: number;
  saleCount: number;
}> {
  const config = await loadCfg();
  const cycleSales = [...sales.values()].filter(
    (s) => s.tenantId === tenantId && s.cropCycleId === cropCycleId,
  );
  const totalSales =
    Math.round(
      cycleSales.reduce((sum, s) => sum + s.totalRevenue, 0) * 100,
    ) / 100;
  const hint = costHints.get(cropCycleId);
  const inputCosts = hint?.inputCost ?? 0;
  const laborCosts =
    hint?.laborCost ?? config.defaultLaborCostPerCycle;
  const grossMargin =
    Math.round((totalSales - inputCosts - laborCosts) * 100) / 100;
  return {
    cropCycleId,
    totalSales,
    inputCosts,
    laborCosts,
    grossMargin,
    saleCount: cycleSales.length,
  };
}

export async function getYieldSummary(
  tenantId: string,
  filter: { fieldId?: string; from?: string; to?: string },
): Promise<{
  fieldId: string | null;
  totalYieldKg: number;
  totalAcres: number;
  yieldPerAcre: number;
  saleRevenue: number;
  cycles: number;
}> {
  const fromMs = filter.from ? Date.parse(filter.from) : 0;
  const toMs = filter.to ? Date.parse(filter.to) : Number.MAX_SAFE_INTEGER;

  const relevantHints = [...costHints.values()].filter((h) => {
    // cost hints don't carry dates; filter sales instead for revenue window
    return true;
  });

  let totalYieldKg = 0;
  let totalAcres = 0;
  let cycles = 0;
  for (const h of relevantHints) {
    if (filter.fieldId) {
      // field filter applied via sales/field association when available
    }
    totalYieldKg += h.yieldKg;
    totalAcres += h.acres;
    cycles += 1;
  }

  const cycleSales = [...sales.values()].filter((s) => {
    if (s.tenantId !== tenantId) return false;
    if (filter.fieldId && s.fieldId !== filter.fieldId) return false;
    const t = Date.parse(s.soldAt);
    return t >= fromMs && t <= toMs;
  });
  const saleRevenue =
    Math.round(
      cycleSales.reduce((sum, s) => sum + s.totalRevenue, 0) * 100,
    ) / 100;

  const yieldPerAcre =
    totalAcres > 0
      ? Math.round((totalYieldKg / totalAcres) * 1000) / 1000
      : 0;

  return {
    fieldId: filter.fieldId || null,
    totalYieldKg,
    totalAcres,
    yieldPerAcre,
    saleRevenue,
    cycles,
  };
}

export async function listSales(
  tenantId: string,
  harvestLotId?: string,
): Promise<Sale[]> {
  return [...sales.values()].filter(
    (s) =>
      s.tenantId === tenantId &&
      (!harvestLotId || s.harvestLotId === harvestLotId),
  );
}
