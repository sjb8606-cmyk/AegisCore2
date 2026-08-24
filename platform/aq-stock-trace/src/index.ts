/**
 * platform/aq-stock-trace (AQ-02)
 *
 * Live organism batches: introduce → holding unit → growth events (hash-chained)
 * → close on harvest. Validates species against AQ-01 authorization via injectable check.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('aq-stock-trace');

const GrowthEventTypes = [
  'feeding',
  'measurement',
  'transfer_internal',
] as const;
export type GrowthEventType = (typeof GrowthEventTypes)[number];

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  requireHealthCertificate: z.boolean().default(true),
});

export type BatchStatus = 'active' | 'harvested';

export interface StockBatch {
  id: string;
  tenantId: string;
  siteId: string;
  species: string;
  strain: string | null;
  sourceHatchery: string | null;
  quantity: number;
  currentQuantity: number;
  initialBiomassKg: number;
  healthCertificateId: string | null;
  holdingUnitId: string | null;
  status: BatchStatus;
  harvestEventId: string | null;
  createdAt: string;
  closedAt: string | null;
}

export interface GrowthEvent {
  id: string;
  tenantId: string;
  batchId: string;
  eventType: GrowthEventType;
  payload: Record<string, unknown>;
  prevHash: string;
  chainHash: string;
  actorId: string;
  createdAt: string;
}

type SiteAuthFn = (
  tenantId: string,
  siteId: string,
  species: string,
) => Promise<boolean>;

const batches = new Map<string, StockBatch>();
const events = new Map<string, GrowthEvent[]>();
let siteAuthFn: SiteAuthFn = async () => true;

export function __resetAqStockTraceStore(): void {
  batches.clear();
  events.clear();
  siteAuthFn = async () => true;
}

export function setSiteAuthFn(fn: SiteAuthFn): void {
  siteAuthFn = fn;
}

async function loadCfg() {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('aq-stock-trace', ConfigSchema);
}

async function chainHash(
  prevHash: string,
  body: Record<string, unknown>,
): Promise<string> {
  try {
    const hc = await import('@platform/hash-chain');
    if (typeof (hc as any).computeChainHash === 'function') {
      return (hc as any).computeChainHash(prevHash, body);
    }
  } catch {
    /* fall through */
  }
  const c = await import('crypto');
  return c
    .createHash('sha256')
    .update(prevHash + JSON.stringify(body))
    .digest('hex');
}

async function genesisHash(): Promise<string> {
  try {
    const hc = await import('@platform/hash-chain');
    if ((hc as any).GENESIS_HASH) return (hc as any).GENESIS_HASH;
  } catch {
    /* fall through */
  }
  return '0'.repeat(64);
}

export async function introduceStock(
  tenantId: string,
  actorId: string,
  input: {
    siteId: string;
    species: string;
    strain?: string;
    sourceHatchery?: string;
    quantity: number;
    initialBiomassKg: number;
    healthCertificateId?: string;
  },
): Promise<StockBatch> {
  return runCrudOperation({
    configName: 'aq-stock-trace',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      if (!input.siteId?.trim() || !input.species?.trim()) {
        throw new AppError('siteId and species required', ErrorCode.BAD_REQUEST);
      }
      if (typeof input.quantity !== 'number' || input.quantity <= 0) {
        throw new AppError('quantity must be positive', ErrorCode.BAD_REQUEST);
      }
      if (
        typeof input.initialBiomassKg !== 'number' ||
        input.initialBiomassKg < 0
      ) {
        throw new AppError(
          'initialBiomassKg must be >= 0',
          ErrorCode.BAD_REQUEST,
        );
      }
      if (
        config.requireHealthCertificate &&
        !input.healthCertificateId?.trim()
      ) {
        throw new AppError(
          'healthCertificateId required',
          ErrorCode.BAD_REQUEST,
        );
      }
      const authorized = await siteAuthFn(
        tenantId,
        input.siteId,
        input.species,
      );
      if (!authorized) {
        throw new AppError(
          'Species not authorized on this site',
          ErrorCode.FORBIDDEN,
        );
      }
      const batch: StockBatch = {
        id: crypto.randomUUID(),
        tenantId,
        siteId: input.siteId,
        species: input.species.trim(),
        strain: input.strain?.trim() || null,
        sourceHatchery: input.sourceHatchery?.trim() || null,
        quantity: input.quantity,
        currentQuantity: input.quantity,
        initialBiomassKg: input.initialBiomassKg,
        healthCertificateId: input.healthCertificateId?.trim() || null,
        holdingUnitId: null,
        status: 'active',
        harvestEventId: null,
        createdAt: new Date().toISOString(),
        closedAt: null,
      };
      batches.set(batch.id, batch);
      events.set(batch.id, []);
      logger.info({ batchId: batch.id, species: batch.species }, 'Stock introduced');
      return batch;
    },
    auditAction: 'data.created',
    auditResource: 'aq_stock_batch',
    meterEventType: 'api_call',
  });
}

export async function assignToHoldingUnit(
  tenantId: string,
  actorId: string,
  input: { batchId: string; holdingUnitId: string },
): Promise<StockBatch> {
  return runCrudOperation({
    configName: 'aq-stock-trace',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const batch = batches.get(input.batchId);
      if (!batch || batch.tenantId !== tenantId) {
        throw new AppError('Batch not found', ErrorCode.NOT_FOUND);
      }
      if (batch.status !== 'active') {
        throw new AppError('Batch not active', ErrorCode.CONFLICT);
      }
      if (!input.holdingUnitId?.trim()) {
        throw new AppError('holdingUnitId required', ErrorCode.BAD_REQUEST);
      }
      batch.holdingUnitId = input.holdingUnitId.trim();
      batches.set(batch.id, batch);
      await logGrowthEvent(tenantId, actorId, batch.id, {
        eventType: 'transfer_internal',
        payload: { holdingUnitId: batch.holdingUnitId },
      });
      return batch;
    },
    auditAction: 'data.updated',
    auditResource: 'aq_stock_batch',
    meterEventType: 'api_call',
  });
}

export async function logGrowthEvent(
  tenantId: string,
  actorId: string,
  batchId: string,
  input: { eventType: GrowthEventType; payload?: Record<string, unknown> },
): Promise<GrowthEvent> {
  return runCrudOperation({
    configName: 'aq-stock-trace',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const batch = batches.get(batchId);
      if (!batch || batch.tenantId !== tenantId) {
        throw new AppError('Batch not found', ErrorCode.NOT_FOUND);
      }
      if (batch.status !== 'active') {
        throw new AppError('Batch not active', ErrorCode.CONFLICT);
      }
      if (!GrowthEventTypes.includes(input.eventType)) {
        throw new AppError('invalid eventType', ErrorCode.BAD_REQUEST);
      }
      const list = events.get(batchId) || [];
      const prevHash =
        list.length > 0 ? list[list.length - 1].chainHash : await genesisHash();
      const body = {
        batchId,
        eventType: input.eventType,
        payload: input.payload || {},
        actorId,
      };
      const hash = await chainHash(prevHash, body);
      const ev: GrowthEvent = {
        id: crypto.randomUUID(),
        tenantId,
        batchId,
        eventType: input.eventType,
        payload: input.payload || {},
        prevHash,
        chainHash: hash,
        actorId,
        createdAt: new Date().toISOString(),
      };
      list.push(ev);
      events.set(batchId, list);
      return ev;
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'aq_growth_event',
    meterEventType: 'api_call',
  });
}

export async function getBatchHistory(
  tenantId: string,
  batchId: string,
): Promise<{ batch: StockBatch; events: GrowthEvent[] }> {
  const batch = batches.get(batchId);
  if (!batch || batch.tenantId !== tenantId) {
    throw new AppError('Batch not found', ErrorCode.NOT_FOUND);
  }
  return { batch, events: [...(events.get(batchId) || [])] };
}

export async function closeBatch(
  tenantId: string,
  actorId: string,
  batchId: string,
  input: { harvestEventId: string },
): Promise<StockBatch> {
  return runCrudOperation({
    configName: 'aq-stock-trace',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const batch = batches.get(batchId);
      if (!batch || batch.tenantId !== tenantId) {
        throw new AppError('Batch not found', ErrorCode.NOT_FOUND);
      }
      if (batch.status !== 'active') {
        throw new AppError('Batch already closed', ErrorCode.CONFLICT);
      }
      if (!input.harvestEventId?.trim()) {
        throw new AppError('harvestEventId required', ErrorCode.BAD_REQUEST);
      }
      batch.status = 'harvested';
      batch.harvestEventId = input.harvestEventId.trim();
      batch.closedAt = new Date().toISOString();
      batches.set(batchId, batch);
      logger.info({ batchId, harvest: batch.harvestEventId }, 'Batch closed');
      return batch;
    },
    auditAction: 'data.updated',
    auditResource: 'aq_stock_batch',
    meterEventType: 'api_call',
  });
}

/** Used by AQ-03 mortality engine to adjust live count */
export async function adjustBatchQuantity(
  tenantId: string,
  batchId: string,
  delta: number,
): Promise<StockBatch> {
  const batch = batches.get(batchId);
  if (!batch || batch.tenantId !== tenantId) {
    throw new AppError('Batch not found', ErrorCode.NOT_FOUND);
  }
  batch.currentQuantity = Math.max(0, batch.currentQuantity + delta);
  batches.set(batchId, batch);
  return batch;
}

export async function getBatch(
  tenantId: string,
  batchId: string,
): Promise<StockBatch | null> {
  const b = batches.get(batchId);
  if (!b || b.tenantId !== tenantId) return null;
  return b;
}
