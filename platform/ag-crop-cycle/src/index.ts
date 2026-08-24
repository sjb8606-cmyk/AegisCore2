/**
 * platform/ag-crop-cycle (AG-02)
 *
 * Event-sourced crop cycles: planting → pesticide → irrigation → harvest.
 * Every event is hash-chained via @platform/hash-chain (same pattern as custody-vault).
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('ag-crop-cycle');

const EventTypes = [
  'planting',
  'pesticide_application',
  'irrigation',
  'harvest',
] as const;
export type CropEventType = (typeof EventTypes)[number];

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  maxOpenCyclesPerField: z.number().int().positive().default(2),
});

export type CycleStatus = 'open' | 'closed';

export interface CropCycle {
  id: string;
  tenantId: string;
  fieldId: string;
  cropType: string;
  plannedPlantDate: string;
  status: CycleStatus;
  finalYieldKg: number | null;
  harvestLotId: string | null;
  createdAt: string;
  closedAt: string | null;
}

export interface CropEvent {
  id: string;
  tenantId: string;
  cropCycleId: string;
  eventType: CropEventType;
  payload: Record<string, unknown>;
  prevHash: string;
  chainHash: string;
  createdAt: string;
  actorId: string;
}

const cycles = new Map<string, CropCycle>();
const events = new Map<string, CropEvent[]>(); // cycleId → ordered events

export function __resetAgCropCycleStore(): void {
  cycles.clear();
  events.clear();
}

async function loadCfg() {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('ag-crop-cycle', ConfigSchema);
}

/** Prefer real hash-chain; fall back to local sha256 chain for isolated tests */
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
  const cryptoNode = await import('crypto');
  const payload = prevHash + JSON.stringify(body);
  return cryptoNode.createHash('sha256').update(payload).digest('hex');
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

export async function startCropCycle(
  tenantId: string,
  actorId: string,
  input: {
    fieldId: string;
    cropType: string;
    plannedPlantDate: string;
  },
): Promise<CropCycle> {
  return runCrudOperation({
    configName: 'ag-crop-cycle',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      if (!input.fieldId?.trim() || !input.cropType?.trim()) {
        throw new AppError(
          'fieldId and cropType required',
          ErrorCode.BAD_REQUEST,
        );
      }
      if (
        !input.plannedPlantDate ||
        Number.isNaN(Date.parse(input.plannedPlantDate))
      ) {
        throw new AppError('invalid plannedPlantDate', ErrorCode.BAD_REQUEST);
      }
      const openOnField = [...cycles.values()].filter(
        (c) =>
          c.tenantId === tenantId &&
          c.fieldId === input.fieldId &&
          c.status === 'open',
      );
      if (openOnField.length >= config.maxOpenCyclesPerField) {
        throw new AppError(
          'Too many open cycles on this field',
          ErrorCode.FORBIDDEN,
        );
      }
      const cycle: CropCycle = {
        id: crypto.randomUUID(),
        tenantId,
        fieldId: input.fieldId,
        cropType: input.cropType.trim(),
        plannedPlantDate: new Date(input.plannedPlantDate).toISOString(),
        status: 'open',
        finalYieldKg: null,
        harvestLotId: null,
        createdAt: new Date().toISOString(),
        closedAt: null,
      };
      cycles.set(cycle.id, cycle);
      events.set(cycle.id, []);
      logger.info({ cycleId: cycle.id, fieldId: input.fieldId }, 'Crop cycle started');
      return cycle;
    },
    auditAction: 'data.created',
    auditResource: 'ag_crop_cycle',
    meterEventType: 'api_call',
  });
}

export async function logEvent(
  tenantId: string,
  actorId: string,
  cropCycleId: string,
  input: { eventType: CropEventType; payload?: Record<string, unknown> },
): Promise<CropEvent> {
  return runCrudOperation({
    configName: 'ag-crop-cycle',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const cycle = cycles.get(cropCycleId);
      if (!cycle || cycle.tenantId !== tenantId) {
        throw new AppError('Crop cycle not found', ErrorCode.NOT_FOUND);
      }
      if (cycle.status !== 'open') {
        throw new AppError('Cycle is closed', ErrorCode.CONFLICT);
      }
      if (!EventTypes.includes(input.eventType)) {
        throw new AppError('invalid eventType', ErrorCode.BAD_REQUEST);
      }
      const list = events.get(cropCycleId) || [];
      const prevHash =
        list.length > 0 ? list[list.length - 1].chainHash : await genesisHash();
      const body = {
        cropCycleId,
        eventType: input.eventType,
        payload: input.payload || {},
        actorId,
      };
      const hash = await chainHash(prevHash, body);
      const ev: CropEvent = {
        id: crypto.randomUUID(),
        tenantId,
        cropCycleId,
        eventType: input.eventType,
        payload: input.payload || {},
        prevHash,
        chainHash: hash,
        createdAt: new Date().toISOString(),
        actorId,
      };
      list.push(ev);
      events.set(cropCycleId, list);
      return ev;
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'ag_crop_event',
    meterEventType: 'api_call',
  });
}

export async function getCycleHistory(
  tenantId: string,
  cropCycleId: string,
): Promise<{ cycle: CropCycle; events: CropEvent[] }> {
  const cycle = cycles.get(cropCycleId);
  if (!cycle || cycle.tenantId !== tenantId) {
    throw new AppError('Crop cycle not found', ErrorCode.NOT_FOUND);
  }
  return { cycle, events: [...(events.get(cropCycleId) || [])] };
}

export async function closeCropCycle(
  tenantId: string,
  actorId: string,
  cropCycleId: string,
  input: { finalYieldKg: number },
): Promise<CropCycle> {
  return runCrudOperation({
    configName: 'ag-crop-cycle',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const cycle = cycles.get(cropCycleId);
      if (!cycle || cycle.tenantId !== tenantId) {
        throw new AppError('Crop cycle not found', ErrorCode.NOT_FOUND);
      }
      if (cycle.status !== 'open') {
        throw new AppError('Cycle already closed', ErrorCode.CONFLICT);
      }
      if (typeof input.finalYieldKg !== 'number' || input.finalYieldKg < 0) {
        throw new AppError('finalYieldKg must be >= 0', ErrorCode.BAD_REQUEST);
      }
      await logEvent(tenantId, actorId, cropCycleId, {
        eventType: 'harvest',
        payload: { finalYieldKg: input.finalYieldKg },
      });
      cycle.status = 'closed';
      cycle.finalYieldKg = input.finalYieldKg;
      cycle.harvestLotId = crypto.randomUUID();
      cycle.closedAt = new Date().toISOString();
      cycles.set(cropCycleId, cycle);
      logger.info(
        { cycleId: cropCycleId, lot: cycle.harvestLotId },
        'Crop cycle closed',
      );
      return cycle;
    },
    auditAction: 'data.updated',
    auditResource: 'ag_crop_cycle',
    meterEventType: 'api_call',
  });
}

export async function getCycle(
  tenantId: string,
  cropCycleId: string,
): Promise<CropCycle | null> {
  const c = cycles.get(cropCycleId);
  if (!c || c.tenantId !== tenantId) return null;
  return c;
}

export async function listCyclesByField(
  tenantId: string,
  fieldId: string,
): Promise<CropCycle[]> {
  return [...cycles.values()].filter(
    (c) => c.tenantId === tenantId && c.fieldId === fieldId,
  );
}
