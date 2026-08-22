/**
 * platform/ingestion-etl
 *
 * Config-driven pull → map fields → validate → normalized store + error queue.
 * Source fetch is injectable (mock by default) so tests stay offline.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('ingestion-etl');

const SourceTypes = ['api', 'file', 'sensor'] as const;
export type SourceType = (typeof SourceTypes)[number];

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  maxBatchSize: z.number().int().positive().default(500),
  maxRetries: z.number().int().nonnegative().default(3),
});

export interface IngestionSource {
  id: string;
  tenantId: string;
  name: string;
  type: SourceType;
  connectionConfig: Record<string, unknown>;
  /** map: destinationField → sourceField */
  schemaMap: Record<string, string>;
  requiredFields: string[];
  scheduleCron: string | null;
  active: boolean;
  createdAt: string;
}

export interface RawRecord {
  id: string;
  tenantId: string;
  sourceId: string;
  payload: Record<string, unknown>;
  receivedAt: string;
}

export interface NormalizedRecord {
  id: string;
  tenantId: string;
  sourceId: string;
  rawId: string;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface ErrorQueueItem {
  id: string;
  tenantId: string;
  sourceId: string;
  rawId: string | null;
  error: string;
  retries: number;
  createdAt: string;
}

type FetchFn = (
  source: IngestionSource,
) => Promise<Record<string, unknown>[]>;

const sources = new Map<string, IngestionSource>();
const rawStore = new Map<string, RawRecord>();
const normalized = new Map<string, NormalizedRecord>();
const errorQueue = new Map<string, ErrorQueueItem>();
let fetchFn: FetchFn = async () => [];

export function __resetIngestionEtlStore(): void {
  sources.clear();
  rawStore.clear();
  normalized.clear();
  errorQueue.clear();
  fetchFn = async () => [];
}

export function setFetchFn(fn: FetchFn): void {
  fetchFn = fn;
}

async function loadCfg() {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('ingestion-etl', ConfigSchema);
}

export function mapRecord(
  payload: Record<string, unknown>,
  schemaMap: Record<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [dest, src] of Object.entries(schemaMap)) {
    if (Object.prototype.hasOwnProperty.call(payload, src)) {
      out[dest] = payload[src];
    }
  }
  return out;
}

export function validateMapped(
  data: Record<string, unknown>,
  requiredFields: string[],
): string | null {
  for (const f of requiredFields) {
    if (data[f] === undefined || data[f] === null || data[f] === '') {
      return 'missing required field: ' + f;
    }
  }
  return null;
}

export async function registerSource(
  tenantId: string,
  actorId: string,
  input: {
    name: string;
    type: SourceType;
    connectionConfig?: Record<string, unknown>;
    schemaMap: Record<string, string>;
    requiredFields?: string[];
    scheduleCron?: string | null;
  },
): Promise<IngestionSource> {
  return runCrudOperation({
    configName: 'ingestion-etl',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!input.name?.trim()) {
        throw new AppError('name is required', ErrorCode.BAD_REQUEST);
      }
      if (!SourceTypes.includes(input.type)) {
        throw new AppError('invalid source type', ErrorCode.BAD_REQUEST);
      }
      if (!input.schemaMap || !Object.keys(input.schemaMap).length) {
        throw new AppError('schemaMap is required', ErrorCode.BAD_REQUEST);
      }
      const src: IngestionSource = {
        id: crypto.randomUUID(),
        tenantId,
        name: input.name.trim(),
        type: input.type,
        connectionConfig: input.connectionConfig || {},
        schemaMap: input.schemaMap,
        requiredFields: input.requiredFields || [],
        scheduleCron: input.scheduleCron ?? null,
        active: true,
        createdAt: new Date().toISOString(),
      };
      sources.set(src.id, src);
      return src;
    },
    auditAction: 'data.created',
    auditResource: 'ingestion_source',
    meterEventType: 'api_call',
  });
}

export async function runIngestion(
  tenantId: string,
  actorId: string,
  sourceId: string,
): Promise<{
  raw: number;
  normalized: number;
  errors: number;
}> {
  return runCrudOperation({
    configName: 'ingestion-etl',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      const source = sources.get(sourceId);
      if (!source || source.tenantId !== tenantId || !source.active) {
        throw new AppError('Source not found or inactive', ErrorCode.NOT_FOUND);
      }

      const batch = await fetchFn(source);
      const slice = batch.slice(0, config.maxBatchSize);
      let rawCount = 0;
      let normCount = 0;
      let errCount = 0;

      for (const payload of slice) {
        const raw: RawRecord = {
          id: crypto.randomUUID(),
          tenantId,
          sourceId,
          payload,
          receivedAt: new Date().toISOString(),
        };
        rawStore.set(raw.id, raw);
        rawCount++;

        const mapped = mapRecord(payload, source.schemaMap);
        const err = validateMapped(mapped, source.requiredFields);
        if (err) {
          const item: ErrorQueueItem = {
            id: crypto.randomUUID(),
            tenantId,
            sourceId,
            rawId: raw.id,
            error: err,
            retries: 0,
            createdAt: new Date().toISOString(),
          };
          errorQueue.set(item.id, item);
          errCount++;
          continue;
        }
        const norm: NormalizedRecord = {
          id: crypto.randomUUID(),
          tenantId,
          sourceId,
          rawId: raw.id,
          data: mapped,
          createdAt: new Date().toISOString(),
        };
        normalized.set(norm.id, norm);
        normCount++;
      }

      logger.info(
        { sourceId, rawCount, normCount, errCount },
        'Ingestion run complete',
      );
      return { raw: rawCount, normalized: normCount, errors: errCount };
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'ingestion_run',
    meterEventType: 'api_call',
  });
}

export async function listNormalized(
  tenantId: string,
  sourceId?: string,
): Promise<NormalizedRecord[]> {
  return [...normalized.values()].filter(
    (n) =>
      n.tenantId === tenantId && (!sourceId || n.sourceId === sourceId),
  );
}

export async function listErrors(
  tenantId: string,
  sourceId?: string,
): Promise<ErrorQueueItem[]> {
  return [...errorQueue.values()].filter(
    (e) =>
      e.tenantId === tenantId && (!sourceId || e.sourceId === sourceId),
  );
}

export async function getSource(
  tenantId: string,
  sourceId: string,
): Promise<IngestionSource | null> {
  const s = sources.get(sourceId);
  if (!s || s.tenantId !== tenantId) return null;
  return s;
}
