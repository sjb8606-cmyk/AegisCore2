/**
 * platform/aq-harvest-trace (AQ-06)
 *
 * Live transfer requests, harvest recording (CSSP gate for shellfish),
 * sales with SFCR lot codes, upstream/downstream lot traversal.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('aq-harvest-trace');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  requireHealthCertOnTransfer: z.boolean().default(true),
  shellfishCultureHints: z
    .array(z.string())
    .default(['oyster', 'mussel', 'clam', 'scallop', 'shellfish']),
});

export type TransferStatus = 'pending' | 'approved' | 'rejected' | 'completed';

export interface TransferRequest {
  id: string;
  tenantId: string;
  batchId: string;
  fromSiteId: string;
  toSiteId: string;
  healthCertificateId: string | null;
  status: TransferStatus;
  createdAt: string;
  actorId: string;
}

export interface HarvestRecord {
  id: string;
  tenantId: string;
  batchId: string;
  siteId: string;
  quantity: number;
  weightKg: number;
  grade: string | null;
  lotCode: string;
  harvestedAt: string;
  actorId: string;
}

export interface SaleRecord {
  id: string;
  tenantId: string;
  harvestId: string;
  lotCode: string;
  buyerName: string;
  quantitySold: number;
  soldAt: string;
  actorId: string;
}

/** Injectable collaborators */
type HarvestEligibilityFn = (
  tenantId: string,
  siteId: string,
) => Promise<{ eligible: boolean; reason: string | null }>;
type BatchSpeciesFn = (
  tenantId: string,
  batchId: string,
) => Promise<{ species: string; siteId: string } | null>;

const transfers = new Map<string, TransferRequest>();
const harvests = new Map<string, HarvestRecord>();
const sales = new Map<string, SaleRecord>();
/** lotCode → harvestId */
const lotIndex = new Map<string, string>();
/** lot edges for traversal */
const lotParents = new Map<string, string[]>(); // child → parents
const lotChildren = new Map<string, string[]>(); // parent → children

let harvestEligibilityFn: HarvestEligibilityFn = async () => ({
  eligible: true,
  reason: null,
});
let batchSpeciesFn: BatchSpeciesFn = async () => null;

export function __resetAqHarvestTraceStore(): void {
  transfers.clear();
  harvests.clear();
  sales.clear();
  lotIndex.clear();
  lotParents.clear();
  lotChildren.clear();
  harvestEligibilityFn = async () => ({ eligible: true, reason: null });
  batchSpeciesFn = async () => null;
}

export function setHarvestEligibilityFn(fn: HarvestEligibilityFn): void {
  harvestEligibilityFn = fn;
}
export function setBatchSpeciesFn(fn: BatchSpeciesFn): void {
  batchSpeciesFn = fn;
}

async function loadCfg() {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('aq-harvest-trace', ConfigSchema);
}

function isShellfish(species: string, hints: string[]): boolean {
  const s = species.toLowerCase();
  return hints.some((h) => s.includes(h.toLowerCase()));
}

function makeLotCode(prefix: string): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rnd = crypto.randomBytes(3).toString('hex').toUpperCase();
  return prefix + '-' + ts + '-' + rnd;
}

function linkLots(parent: string, child: string): void {
  const parents = lotParents.get(child) || [];
  if (!parents.includes(parent)) {
    parents.push(parent);
    lotParents.set(child, parents);
  }
  const children = lotChildren.get(parent) || [];
  if (!children.includes(child)) {
    children.push(child);
    lotChildren.set(parent, children);
  }
}

export async function requestTransfer(
  tenantId: string,
  actorId: string,
  input: {
    batchId: string;
    fromSiteId: string;
    toSiteId: string;
    healthCertificateId?: string;
  },
): Promise<TransferRequest> {
  return runCrudOperation({
    configName: 'aq-harvest-trace',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      if (
        !input.batchId?.trim() ||
        !input.fromSiteId?.trim() ||
        !input.toSiteId?.trim()
      ) {
        throw new AppError(
          'batchId, fromSiteId, toSiteId required',
          ErrorCode.BAD_REQUEST,
        );
      }
      if (
        config.requireHealthCertOnTransfer &&
        !input.healthCertificateId?.trim()
      ) {
        throw new AppError(
          'healthCertificateId required for transfer',
          ErrorCode.FORBIDDEN,
        );
      }
      const req: TransferRequest = {
        id: crypto.randomUUID(),
        tenantId,
        batchId: input.batchId,
        fromSiteId: input.fromSiteId,
        toSiteId: input.toSiteId,
        healthCertificateId: input.healthCertificateId?.trim() || null,
        status: 'approved',
        createdAt: new Date().toISOString(),
        actorId,
      };
      transfers.set(req.id, req);
      logger.info(
        { transferId: req.id, batchId: req.batchId },
        'Transfer request approved',
      );
      return req;
    },
    auditAction: 'data.created',
    auditResource: 'aq_transfer',
    meterEventType: 'api_call',
  });
}

export async function recordHarvest(
  tenantId: string,
  actorId: string,
  input: {
    batchId: string;
    siteId: string;
    quantity: number;
    weightKg: number;
    grade?: string;
  },
): Promise<HarvestRecord> {
  return runCrudOperation({
    configName: 'aq-harvest-trace',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      if (!input.batchId?.trim() || !input.siteId?.trim()) {
        throw new AppError('batchId and siteId required', ErrorCode.BAD_REQUEST);
      }
      if (
        typeof input.quantity !== 'number' ||
        input.quantity <= 0 ||
        typeof input.weightKg !== 'number' ||
        input.weightKg < 0
      ) {
        throw new AppError(
          'quantity must be > 0 and weightKg >= 0',
          ErrorCode.BAD_REQUEST,
        );
      }

      const batchInfo = await batchSpeciesFn(tenantId, input.batchId);
      const species = batchInfo?.species || '';
      if (isShellfish(species, config.shellfishCultureHints)) {
        const elig = await harvestEligibilityFn(tenantId, input.siteId);
        if (!elig.eligible) {
          throw new AppError(
            'Harvest blocked by CSSP: ' + (elig.reason || 'not eligible'),
            ErrorCode.FORBIDDEN,
          );
        }
      }

      const lotCode = makeLotCode('AQ');
      const harvest: HarvestRecord = {
        id: crypto.randomUUID(),
        tenantId,
        batchId: input.batchId,
        siteId: input.siteId,
        quantity: input.quantity,
        weightKg: input.weightKg,
        grade: input.grade?.trim() || null,
        lotCode,
        harvestedAt: new Date().toISOString(),
        actorId,
      };
      harvests.set(harvest.id, harvest);
      lotIndex.set(lotCode, harvest.id);
      // batch is conceptual parent of harvest lot
      linkLots('BATCH:' + input.batchId, lotCode);
      logger.info({ harvestId: harvest.id, lotCode }, 'Harvest recorded');
      return harvest;
    },
    auditAction: 'data.created',
    auditResource: 'aq_harvest',
    meterEventType: 'api_call',
  });
}

export async function recordSale(
  tenantId: string,
  actorId: string,
  input: {
    harvestId: string;
    buyerName: string;
    quantitySold: number;
    lotCode?: string;
  },
): Promise<SaleRecord> {
  return runCrudOperation({
    configName: 'aq-harvest-trace',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const harvest = harvests.get(input.harvestId);
      if (!harvest || harvest.tenantId !== tenantId) {
        throw new AppError('Harvest not found', ErrorCode.NOT_FOUND);
      }
      if (!input.buyerName?.trim()) {
        throw new AppError('buyerName required', ErrorCode.BAD_REQUEST);
      }
      if (typeof input.quantitySold !== 'number' || input.quantitySold <= 0) {
        throw new AppError('quantitySold must be positive', ErrorCode.BAD_REQUEST);
      }
      const saleLot = input.lotCode?.trim() || makeLotCode('SALE');
      const sale: SaleRecord = {
        id: crypto.randomUUID(),
        tenantId,
        harvestId: harvest.id,
        lotCode: saleLot,
        buyerName: input.buyerName.trim(),
        quantitySold: input.quantitySold,
        soldAt: new Date().toISOString(),
        actorId,
      };
      sales.set(sale.id, sale);
      lotIndex.set(saleLot, harvest.id);
      linkLots(harvest.lotCode, saleLot);
      return sale;
    },
    auditAction: 'data.created',
    auditResource: 'aq_sale',
    meterEventType: 'api_call',
  });
}

export async function traceLotUpstream(
  tenantId: string,
  lotCode: string,
): Promise<string[]> {
  // verify lot belongs to tenant via harvest/sale
  const harvestId = lotIndex.get(lotCode);
  if (harvestId) {
    const h = harvests.get(harvestId);
    if (h && h.tenantId !== tenantId) {
      throw new AppError('Lot not found', ErrorCode.NOT_FOUND);
    }
  }
  const seen = new Set<string>();
  const result: string[] = [];
  const stack = [...(lotParents.get(lotCode) || [])];
  while (stack.length) {
    const p = stack.pop()!;
    if (seen.has(p)) continue;
    seen.add(p);
    result.push(p);
    for (const gp of lotParents.get(p) || []) stack.push(gp);
  }
  return result;
}

export async function traceLotDownstream(
  tenantId: string,
  lotCode: string,
): Promise<string[]> {
  const harvestId = lotIndex.get(lotCode);
  if (harvestId) {
    const h = harvests.get(harvestId);
    if (h && h.tenantId !== tenantId) {
      throw new AppError('Lot not found', ErrorCode.NOT_FOUND);
    }
  }
  const seen = new Set<string>();
  const result: string[] = [];
  const stack = [...(lotChildren.get(lotCode) || [])];
  while (stack.length) {
    const c = stack.pop()!;
    if (seen.has(c)) continue;
    seen.add(c);
    result.push(c);
    for (const gc of lotChildren.get(c) || []) stack.push(gc);
  }
  return result;
}

export async function getHarvest(
  tenantId: string,
  harvestId: string,
): Promise<HarvestRecord | null> {
  const h = harvests.get(harvestId);
  if (!h || h.tenantId !== tenantId) return null;
  return h;
}
