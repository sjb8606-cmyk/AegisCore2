/**
 * platform/aq-health-mortality (AQ-03)
 *
 * Deterministic mortality threshold detection + reportable disease workflow.
 * Thresholds (corroborated across research):
 *   finfish: >2% / 24h OR >5% / 5 days
 *   shellfish: >15% / 12 months
 * Never auto-submits to regulator — flags pending_review only.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('aq-health-mortality');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  finfishSpeciesHints: z
    .array(z.string())
    .default(['salmon', 'trout', 'char', 'cod', 'finfish']),
  shellfishSpeciesHints: z
    .array(z.string())
    .default(['oyster', 'mussel', 'clam', 'scallop', 'shellfish']),
  finfishPct24h: z.number().default(2),
  finfishPct5d: z.number().default(5),
  shellfishPct12m: z.number().default(15),
});

export type StockClass = 'finfish' | 'shellfish' | 'unknown';

export interface MortalityEvent {
  id: string;
  tenantId: string;
  batchId: string;
  holdingUnitId: string | null;
  quantity: number;
  cause: string;
  stockClass: StockClass;
  pctOfStock: number;
  reportable: boolean;
  reportableReason: string | null;
  reviewStatus: 'none' | 'pending_review' | 'submitted' | 'cleared';
  createdAt: string;
  actorId: string;
}

export interface HealthObservation {
  id: string;
  tenantId: string;
  batchId: string;
  condition: string;
  diagnosticResult: string | null;
  reportable: boolean;
  reviewStatus: 'none' | 'pending_review' | 'submitted' | 'cleared';
  createdAt: string;
  actorId: string;
}

/** Injectable: current live count + species for a batch (from AQ-02) */
type BatchInfoFn = (
  tenantId: string,
  batchId: string,
) => Promise<{ currentQuantity: number; species: string } | null>;

/** Injectable: reportable disease list lookup */
type ReportableConditionFn = (condition: string) => boolean;

const mortalities = new Map<string, MortalityEvent>();
const observations = new Map<string, HealthObservation>();
/** batchId → mortality events chronological */
const byBatch = new Map<string, string[]>();

let batchInfoFn: BatchInfoFn = async () => null;
let reportableConditionFn: ReportableConditionFn = () => false;

export function __resetAqHealthMortalityStore(): void {
  mortalities.clear();
  observations.clear();
  byBatch.clear();
  batchInfoFn = async () => null;
  reportableConditionFn = () => false;
}

export function setBatchInfoFn(fn: BatchInfoFn): void {
  batchInfoFn = fn;
}
export function setReportableConditionFn(fn: ReportableConditionFn): void {
  reportableConditionFn = fn;
}

/** Seed a small built-in list for tests; production replaces with CFIA list */
export function seedDefaultReportableConditions(): void {
  const list = new Set(
    [
      'isa',
      'infectious salmon anemia',
      'vhv',
      'viral hemorrhagic septicemia',
      'ihnv',
      'aeromonas salmonicida',
      'msx',
      'dermo',
    ].map((s) => s.toLowerCase()),
  );
  reportableConditionFn = (c) => list.has(c.toLowerCase());
}

async function loadCfg() {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('aq-health-mortality', ConfigSchema);
}

export function classifyStock(
  species: string,
  config: z.infer<typeof ConfigSchema>,
): StockClass {
  const s = species.toLowerCase();
  if (config.finfishSpeciesHints.some((h) => s.includes(h.toLowerCase()))) {
    return 'finfish';
  }
  if (config.shellfishSpeciesHints.some((h) => s.includes(h.toLowerCase()))) {
    return 'shellfish';
  }
  return 'unknown';
}

function sumMortalityInWindow(
  batchId: string,
  windowMs: number,
  now = Date.now(),
): number {
  const ids = byBatch.get(batchId) || [];
  let sum = 0;
  for (const id of ids) {
    const m = mortalities.get(id);
    if (!m) continue;
    if (now - Date.parse(m.createdAt) <= windowMs) {
      sum += m.quantity;
    }
  }
  return sum;
}

export async function logMortality(
  tenantId: string,
  actorId: string,
  input: {
    batchId: string;
    holdingUnitId?: string;
    quantity: number;
    cause: string;
  },
): Promise<MortalityEvent> {
  return runCrudOperation({
    configName: 'aq-health-mortality',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      if (!input.batchId?.trim() || !input.cause?.trim()) {
        throw new AppError('batchId and cause required', ErrorCode.BAD_REQUEST);
      }
      if (typeof input.quantity !== 'number' || input.quantity <= 0) {
        throw new AppError('quantity must be positive', ErrorCode.BAD_REQUEST);
      }
      const info = await batchInfoFn(tenantId, input.batchId);
      if (!info) {
        throw new AppError('Batch not found', ErrorCode.NOT_FOUND);
      }
      if (info.currentQuantity <= 0) {
        throw new AppError('Batch has zero stock', ErrorCode.CONFLICT);
      }

      const stockClass = classifyStock(info.species, config);
      const baseCount = info.currentQuantity;
      const pct = Math.round((input.quantity / baseCount) * 10000) / 100;

      // Rolling windows include this event
      const dayMs = 86_400_000;
      const prior24 = sumMortalityInWindow(input.batchId, dayMs);
      const prior5d = sumMortalityInWindow(input.batchId, 5 * dayMs);
      const prior12m = sumMortalityInWindow(input.batchId, 365 * dayMs);

      const pct24 = ((prior24 + input.quantity) / baseCount) * 100;
      const pct5d = ((prior5d + input.quantity) / baseCount) * 100;
      const pct12m = ((prior12m + input.quantity) / baseCount) * 100;

      let reportable = false;
      let reportableReason: string | null = null;

      if (stockClass === 'finfish') {
        if (pct24 > config.finfishPct24h) {
          reportable = true;
          reportableReason =
            'Finfish mortality >' +
            config.finfishPct24h +
            '% in 24h (' +
            pct24.toFixed(2) +
            '%)';
        } else if (pct5d > config.finfishPct5d) {
          reportable = true;
          reportableReason =
            'Finfish mortality >' +
            config.finfishPct5d +
            '% in 5 days (' +
            pct5d.toFixed(2) +
            '%)';
        }
      } else if (stockClass === 'shellfish') {
        if (pct12m > config.shellfishPct12m) {
          reportable = true;
          reportableReason =
            'Shellfish mortality >' +
            config.shellfishPct12m +
            '% in 12 months (' +
            pct12m.toFixed(2) +
            '%)';
        }
      }

      const event: MortalityEvent = {
        id: crypto.randomUUID(),
        tenantId,
        batchId: input.batchId,
        holdingUnitId: input.holdingUnitId || null,
        quantity: input.quantity,
        cause: input.cause.trim(),
        stockClass,
        pctOfStock: pct,
        reportable,
        reportableReason,
        reviewStatus: reportable ? 'pending_review' : 'none',
        createdAt: new Date().toISOString(),
        actorId,
      };
      mortalities.set(event.id, event);
      const list = byBatch.get(input.batchId) || [];
      list.push(event.id);
      byBatch.set(input.batchId, list);

      if (reportable) {
        logger.warn(
          { eventId: event.id, reason: reportableReason },
          'Reportable mortality — pending human review (not auto-submitted)',
        );
      }
      return event;
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'aq_mortality_event',
    meterEventType: 'api_call',
  });
}

export async function logHealthObservation(
  tenantId: string,
  actorId: string,
  input: {
    batchId: string;
    condition: string;
    diagnosticResult?: string;
  },
): Promise<HealthObservation> {
  return runCrudOperation({
    configName: 'aq-health-mortality',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!input.batchId?.trim() || !input.condition?.trim()) {
        throw new AppError(
          'batchId and condition required',
          ErrorCode.BAD_REQUEST,
        );
      }
      const info = await batchInfoFn(tenantId, input.batchId);
      if (!info) {
        throw new AppError('Batch not found', ErrorCode.NOT_FOUND);
      }
      const reportable = reportableConditionFn(input.condition);
      const obs: HealthObservation = {
        id: crypto.randomUUID(),
        tenantId,
        batchId: input.batchId,
        condition: input.condition.trim(),
        diagnosticResult: input.diagnosticResult?.trim() || null,
        reportable,
        reviewStatus: reportable ? 'pending_review' : 'none',
        createdAt: new Date().toISOString(),
        actorId,
      };
      observations.set(obs.id, obs);
      if (reportable) {
        logger.warn(
          { obsId: obs.id, condition: obs.condition },
          'Reportable condition — pending human review',
        );
      }
      return obs;
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'aq_health_observation',
    meterEventType: 'api_call',
  });
}

export async function getReportableEventStatus(
  tenantId: string,
  batchId: string,
): Promise<{
  mortalities: MortalityEvent[];
  observations: HealthObservation[];
  pendingReviewCount: number;
}> {
  const morts = [...mortalities.values()].filter(
    (m) => m.tenantId === tenantId && m.batchId === batchId && m.reportable,
  );
  const obs = [...observations.values()].filter(
    (o) => o.tenantId === tenantId && o.batchId === batchId && o.reportable,
  );
  const pendingReviewCount =
    morts.filter((m) => m.reviewStatus === 'pending_review').length +
    obs.filter((o) => o.reviewStatus === 'pending_review').length;
  return { mortalities: morts, observations: obs, pendingReviewCount };
}
