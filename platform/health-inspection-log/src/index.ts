/**
 * platform/health-inspection-log (REST-06)
 *
 * Ops compliance: equipment temp logs, sanitizer ppm, corrective actions.
 * Deterministic out-of-range flags — no LLM.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('health-inspection-log');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  coldMaxC: z.number().default(4),
  hotMinC: z.number().default(60),
  sanitizerPpmMin: z.number().default(50),
  sanitizerPpmMax: z.number().default(200),
});

export type LogKind = 'cold_hold' | 'hot_hold' | 'sanitizer' | 'other';

export interface HealthLogEntry {
  id: string;
  tenantId: string;
  kind: LogKind;
  locationLabel: string;
  value: number;
  unit: string;
  inRange: boolean;
  correctiveAction: string | null;
  corrected: boolean;
  recordedAt: string;
  actorId: string;
}

const entries = new Map<string, HealthLogEntry>();

export function __resetHealthInspectionLogStore(): void {
  entries.clear();
}

function evaluateRange(
  kind: LogKind,
  value: number,
  config: z.infer<typeof ConfigSchema>,
): boolean {
  if (kind === 'cold_hold') return value <= config.coldMaxC;
  if (kind === 'hot_hold') return value >= config.hotMinC;
  if (kind === 'sanitizer') {
    return value >= config.sanitizerPpmMin && value <= config.sanitizerPpmMax;
  }
  return true;
}

export async function logReading(
  tenantId: string,
  actorId: string,
  input: {
    kind: LogKind;
    locationLabel: string;
    value: number;
    unit?: string;
    correctiveAction?: string;
  },
): Promise<HealthLogEntry> {
  return runCrudOperation({
    configName: 'health-inspection-log',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('health-inspection-log', ConfigSchema);
      if (!['cold_hold', 'hot_hold', 'sanitizer', 'other'].includes(input.kind)) {
        throw new AppError('invalid kind', ErrorCode.BAD_REQUEST);
      }
      if (!input.locationLabel?.trim()) {
        throw new AppError('locationLabel required', ErrorCode.BAD_REQUEST);
      }
      if (typeof input.value !== 'number' || Number.isNaN(input.value)) {
        throw new AppError('value must be a number', ErrorCode.BAD_REQUEST);
      }
      const inRange = evaluateRange(input.kind, input.value, config);
      const unit =
        input.unit?.trim() ||
        (input.kind === 'sanitizer' ? 'ppm' : 'C');
      const entry: HealthLogEntry = {
        id: crypto.randomUUID(),
        tenantId,
        kind: input.kind,
        locationLabel: input.locationLabel.trim(),
        value: input.value,
        unit,
        inRange,
        correctiveAction: input.correctiveAction?.trim() || null,
        corrected: false,
        recordedAt: new Date().toISOString(),
        actorId,
      };
      entries.set(entry.id, entry);
      if (!inRange) {
        logger.warn(
          { entryId: entry.id, kind: entry.kind, value: entry.value },
          'Out-of-range health reading',
        );
      }
      return entry;
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'rest_health_log',
    meterEventType: 'api_call',
  });
}

export async function addCorrectiveAction(
  tenantId: string,
  actorId: string,
  entryId: string,
  action: string,
  markCorrected = true,
): Promise<HealthLogEntry> {
  return runCrudOperation({
    configName: 'health-inspection-log',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const entry = entries.get(entryId);
      if (!entry || entry.tenantId !== tenantId) {
        throw new AppError('Entry not found', ErrorCode.NOT_FOUND);
      }
      if (!action?.trim()) {
        throw new AppError('corrective action required', ErrorCode.BAD_REQUEST);
      }
      entry.correctiveAction = action.trim();
      if (markCorrected) entry.corrected = true;
      entries.set(entryId, entry);
      return entry;
    },
    auditAction: 'data.updated',
    auditResource: 'rest_health_log',
    meterEventType: 'api_call',
  });
}

export async function listOutOfRange(
  tenantId: string,
  actorId: string,
  uncorrectedOnly = true,
): Promise<HealthLogEntry[]> {
  return runCrudOperation({
    configName: 'health-inspection-log',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () =>
      [...entries.values()]
        .filter(
          (e) =>
            e.tenantId === tenantId &&
            !e.inRange &&
            (!uncorrectedOnly || !e.corrected),
        )
        .sort(
          (a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt),
        ),
    auditAction: 'data.read',
    auditResource: 'rest_health_log',
    meterEventType: 'api_call',
  });
}

export async function getShiftHealthSummary(
  tenantId: string,
  actorId: string,
  sinceIso: string,
): Promise<{
  total: number;
  outOfRange: number;
  uncorrected: number;
  entries: HealthLogEntry[];
}> {
  return runCrudOperation({
    configName: 'health-inspection-log',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const since = Date.parse(sinceIso);
      if (Number.isNaN(since)) {
        throw new AppError('invalid since timestamp', ErrorCode.BAD_REQUEST);
      }
      const rows = [...entries.values()].filter(
        (e) => e.tenantId === tenantId && Date.parse(e.recordedAt) >= since,
      );
      const outOfRange = rows.filter((e) => !e.inRange);
      return {
        total: rows.length,
        outOfRange: outOfRange.length,
        uncorrected: outOfRange.filter((e) => !e.corrected).length,
        entries: rows.sort(
          (a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt),
        ),
      };
    },
    auditAction: 'data.read',
    auditResource: 'rest_health_log',
    meterEventType: 'api_call',
  });
}
