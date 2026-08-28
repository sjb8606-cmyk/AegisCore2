/**
 * platform/slip-power-water-metering (MAR-01)
 *
 * Shore power (kWh) + water (m³) meter readings per slip → billable usage.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('slip-power-water-metering');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  powerRateCentsPerKwh: z.number().int().nonnegative().default(25),
  waterRateCentsPerM3: z.number().int().nonnegative().default(400),
  requireMonotonicMeters: z.boolean().default(true),
});

export type UtilityKind = 'power' | 'water';

export interface MeterState {
  tenantId: string;
  slipId: string;
  kind: UtilityKind;
  lastReading: number;
  lastReadAt: string | null;
}

export interface MeterReading {
  id: string;
  tenantId: string;
  slipId: string;
  kind: UtilityKind;
  reading: number;
  usage: number;
  chargeCents: number;
  readAt: string;
  actorId: string;
}

const meters = new Map<string, MeterState>();
const readings = new Map<string, MeterReading>();

export function __resetSlipMeteringStore(): void {
  meters.clear();
  readings.clear();
}

function meterKey(tenantId: string, slipId: string, kind: UtilityKind): string {
  return tenantId + ':' + slipId + ':' + kind;
}

function getOrInitMeter(
  tenantId: string,
  slipId: string,
  kind: UtilityKind,
): MeterState {
  const k = meterKey(tenantId, slipId, kind);
  let m = meters.get(k);
  if (!m) {
    m = {
      tenantId,
      slipId,
      kind,
      lastReading: 0,
      lastReadAt: null,
    };
    meters.set(k, m);
  }
  return m;
}

export async function recordReading(
  tenantId: string,
  actorId: string,
  input: {
    slipId: string;
    kind: UtilityKind;
    reading: number;
    readAt?: string;
  },
): Promise<MeterReading> {
  return runCrudOperation({
    configName: 'slip-power-water-metering',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('slip-power-water-metering', ConfigSchema);
      if (!input.slipId?.trim()) {
        throw new AppError('slipId required', ErrorCode.BAD_REQUEST);
      }
      if (input.kind !== 'power' && input.kind !== 'water') {
        throw new AppError('kind must be power or water', ErrorCode.BAD_REQUEST);
      }
      if (typeof input.reading !== 'number' || input.reading < 0) {
        throw new AppError('reading must be >= 0', ErrorCode.BAD_REQUEST);
      }
      const when = input.readAt ? Date.parse(input.readAt) : Date.now();
      if (Number.isNaN(when)) {
        throw new AppError('invalid readAt', ErrorCode.BAD_REQUEST);
      }

      const meter = getOrInitMeter(tenantId, input.slipId, input.kind);
      if (config.requireMonotonicMeters && input.reading < meter.lastReading) {
        throw new AppError(
          'Reading lower than previous (possible meter reset — handle manually)',
          ErrorCode.CONFLICT,
        );
      }
      const usage = Math.max(0, input.reading - meter.lastReading);
      const rate =
        input.kind === 'power'
          ? config.powerRateCentsPerKwh
          : config.waterRateCentsPerM3;
      const chargeCents = Math.round(usage * rate);

      meter.lastReading = input.reading;
      meter.lastReadAt = new Date(when).toISOString();
      meters.set(meterKey(tenantId, input.slipId, input.kind), meter);

      const row: MeterReading = {
        id: crypto.randomUUID(),
        tenantId,
        slipId: input.slipId,
        kind: input.kind,
        reading: input.reading,
        usage,
        chargeCents,
        readAt: meter.lastReadAt,
        actorId,
      };
      readings.set(row.id, row);
      logger.info(
        { slipId: input.slipId, kind: input.kind, usage, chargeCents },
        'Meter reading recorded',
      );
      return row;
    },
    auditAction: 'data.created',
    auditResource: 'marina_meter_reading',
    meterEventType: 'api_call',
  });
}

export async function getSlipUsage(
  tenantId: string,
  actorId: string,
  slipId: string,
  sinceIso: string,
): Promise<{
  powerUsage: number;
  waterUsage: number;
  powerChargeCents: number;
  waterChargeCents: number;
  readings: MeterReading[];
}> {
  return runCrudOperation({
    configName: 'slip-power-water-metering',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const since = Date.parse(sinceIso);
      if (Number.isNaN(since)) {
        throw new AppError('invalid since', ErrorCode.BAD_REQUEST);
      }
      const rows = [...readings.values()].filter(
        (r) =>
          r.tenantId === tenantId &&
          r.slipId === slipId &&
          Date.parse(r.readAt) >= since,
      );
      const power = rows.filter((r) => r.kind === 'power');
      const water = rows.filter((r) => r.kind === 'water');
      return {
        powerUsage: power.reduce((s, r) => s + r.usage, 0),
        waterUsage: water.reduce((s, r) => s + r.usage, 0),
        powerChargeCents: power.reduce((s, r) => s + r.chargeCents, 0),
        waterChargeCents: water.reduce((s, r) => s + r.chargeCents, 0),
        readings: rows.sort(
          (a, b) => Date.parse(a.readAt) - Date.parse(b.readAt),
        ),
      };
    },
    auditAction: 'data.read',
    auditResource: 'marina_meter_reading',
    meterEventType: 'api_call',
  });
}

export async function getMeterState(
  tenantId: string,
  actorId: string,
  slipId: string,
  kind: UtilityKind,
): Promise<MeterState> {
  return runCrudOperation({
    configName: 'slip-power-water-metering',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => getOrInitMeter(tenantId, slipId, kind),
    auditAction: 'data.read',
    auditResource: 'marina_meter_state',
    meterEventType: 'api_call',
  });
}
