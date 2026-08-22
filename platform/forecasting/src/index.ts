/**
 * platform/forecasting
 *
 * Ingest time-series → simple model refresh → predict(horizon) + confidence.
 * MVP uses moving-average + trend (no external ML deps). Real models plug in later.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('forecasting');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  entityType: z.string().default('generic'),
  signals: z.array(z.string()).default([]),
  retrainCadenceHours: z.number().default(24),
  defaultHorizon: z.number().int().positive().default(7),
  minHistoryPoints: z.number().int().positive().default(3),
  modelVersion: z.string().default('ma-trend-v1'),
});

export type ForecastingConfig = z.infer<typeof ConfigSchema>;

export interface ForecastPoint {
  id: string;
  tenantId: string;
  entityId: string;
  timestamp: string;
  value: number;
  source: string;
}

export interface ForecastResult {
  id: string;
  tenantId: string;
  entityId: string;
  predictedFor: string;
  value: number;
  confidence: number;
  modelVersion: string;
  createdAt: string;
}

const series = new Map<string, ForecastPoint[]>(); // key: tenant:entity
const results = new Map<string, ForecastResult[]>();
const modelMeta = new Map<string, { trainedAt: string; n: number; mean: number; slope: number }>();

export function __resetForecastingStore(): void {
  series.clear();
  results.clear();
  modelMeta.clear();
}

function key(tenantId: string, entityId: string): string {
  return tenantId + ':' + entityId;
}

async function loadCfg(): Promise<ForecastingConfig> {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('forecasting', ConfigSchema);
}

export async function ingestHistory(
  tenantId: string,
  actorId: string,
  input: {
    entityId: string;
    points: { timestamp: string; value: number; source?: string }[];
  },
): Promise<{ ingested: number }> {
  return runCrudOperation({
    configName: 'forecasting',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!input.entityId) {
        throw new AppError('entityId is required', ErrorCode.BAD_REQUEST);
      }
      if (!input.points?.length) {
        throw new AppError('points required', ErrorCode.BAD_REQUEST);
      }
      const k = key(tenantId, input.entityId);
      const list = series.get(k) || [];
      for (const p of input.points) {
        if (typeof p.value !== 'number' || Number.isNaN(p.value)) {
          throw new AppError('invalid value', ErrorCode.BAD_REQUEST);
        }
        list.push({
          id: crypto.randomUUID(),
          tenantId,
          entityId: input.entityId,
          timestamp: p.timestamp || new Date().toISOString(),
          value: p.value,
          source: p.source || 'history',
        });
      }
      list.sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );
      series.set(k, list);
      return { ingested: input.points.length };
    },
    auditAction: 'data.created',
    auditResource: 'forecast_series',
    meterEventType: 'api_call',
  });
}

/** Fit simple mean + linear slope on last N points */
export function trainModel(
  values: number[],
): { mean: number; slope: number; n: number } {
  const n = values.length;
  if (n === 0) return { mean: 0, slope: 0, n: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  if (n === 1) return { mean, slope: 0, n };
  let num = 0;
  let den = 0;
  const mid = (n - 1) / 2;
  for (let i = 0; i < n; i++) {
    const x = i - mid;
    num += x * (values[i] - mean);
    den += x * x;
  }
  const slope = den === 0 ? 0 : num / den;
  return { mean, slope, n };
}

export async function refreshModel(
  tenantId: string,
  actorId: string,
  entityId: string,
): Promise<{ entityId: string; n: number; mean: number; slope: number }> {
  return runCrudOperation({
    configName: 'forecasting',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      const list = series.get(key(tenantId, entityId)) || [];
      if (list.length < config.minHistoryPoints) {
        throw new AppError(
          'insufficient history (need ' + config.minHistoryPoints + ' points)',
          ErrorCode.BAD_REQUEST,
        );
      }
      const values = list.map((p) => p.value);
      const fit = trainModel(values);
      modelMeta.set(key(tenantId, entityId), {
        trainedAt: new Date().toISOString(),
        ...fit,
      });
      logger.info({ entityId, n: fit.n }, 'Forecast model refreshed');
      return { entityId, ...fit };
    },
    auditAction: 'data.updated',
    auditResource: 'forecast_model',
    meterEventType: 'api_call',
  });
}

export async function predict(
  tenantId: string,
  actorId: string,
  input: { entityId: string; horizon?: number },
): Promise<ForecastResult[]> {
  return runCrudOperation({
    configName: 'forecasting',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      const horizon = input.horizon ?? config.defaultHorizon;
      if (horizon < 1) {
        throw new AppError('horizon must be >= 1', ErrorCode.BAD_REQUEST);
      }
      const k = key(tenantId, input.entityId);
      let meta = modelMeta.get(k);
      if (!meta) {
        await refreshModel(tenantId, actorId, input.entityId);
        meta = modelMeta.get(k)!;
      }

      // Confidence shrinks with horizon and grows with sample size
      const baseConf = Math.min(0.95, 0.5 + meta.n / 40);
      const out: ForecastResult[] = [];
      const now = Date.now();
      for (let h = 1; h <= horizon; h++) {
        const value =
          Math.round((meta.mean + meta.slope * (meta.n / 2 + h)) * 1000) /
          1000;
        const confidence =
          Math.round(Math.max(0.1, baseConf * (1 - h / (horizon + 5))) * 1000) /
          1000;
        const rec: ForecastResult = {
          id: crypto.randomUUID(),
          tenantId,
          entityId: input.entityId,
          predictedFor: new Date(now + h * 86_400_000).toISOString(),
          value,
          confidence,
          modelVersion: config.modelVersion,
          createdAt: new Date().toISOString(),
        };
        out.push(rec);
      }
      const prev = results.get(k) || [];
      results.set(k, prev.concat(out));
      return out;
    },
    auditAction: 'data.read',
    auditResource: 'forecast_result',
    meterEventType: 'api_call',
  });
}

export async function getSeries(
  tenantId: string,
  entityId: string,
): Promise<ForecastPoint[]> {
  return series.get(key(tenantId, entityId)) || [];
}

export async function getLatestResults(
  tenantId: string,
  entityId: string,
): Promise<ForecastResult[]> {
  return results.get(key(tenantId, entityId)) || [];
}
