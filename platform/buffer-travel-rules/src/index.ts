/**
 * platform/buffer-travel-rules (SCH-02)
 *
 * Before/after buffers + travel time between locations.
 * Expands effective busy window for conflict checks.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('buffer-travel-rules');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  defaultBeforeMinutes: z.number().int().nonnegative().default(0),
  defaultAfterMinutes: z.number().int().nonnegative().default(0),
  defaultTravelMinutes: z.number().int().nonnegative().default(0),
});

export interface ResourceBufferPolicy {
  id: string;
  tenantId: string;
  resourceId: string;
  beforeMinutes: number;
  afterMinutes: number;
}

export interface TravelPair {
  id: string;
  tenantId: string;
  fromLocationId: string;
  toLocationId: string;
  travelMinutes: number;
}

export interface EffectiveWindow {
  startAt: string;
  endAt: string;
  beforeMinutes: number;
  afterMinutes: number;
  travelMinutes: number;
}

const policies = new Map<string, ResourceBufferPolicy>();
const travel = new Map<string, TravelPair>();

export function __resetBufferTravelStore(): void {
  policies.clear();
  travel.clear();
}

function travelKey(
  tenantId: string,
  from: string,
  to: string,
): string {
  return tenantId + ':' + from + ':' + to;
}

export async function setResourceBuffers(
  tenantId: string,
  actorId: string,
  input: {
    resourceId: string;
    beforeMinutes?: number;
    afterMinutes?: number;
  },
): Promise<ResourceBufferPolicy> {
  return runCrudOperation({
    configName: 'buffer-travel-rules',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('buffer-travel-rules', ConfigSchema);
      if (!input.resourceId?.trim()) {
        throw new AppError('resourceId required', ErrorCode.BAD_REQUEST);
      }
      const existing = [...policies.values()].find(
        (p) => p.tenantId === tenantId && p.resourceId === input.resourceId,
      );
      const row: ResourceBufferPolicy = {
        id: existing?.id || crypto.randomUUID(),
        tenantId,
        resourceId: input.resourceId,
        beforeMinutes:
          input.beforeMinutes ??
          existing?.beforeMinutes ??
          config.defaultBeforeMinutes,
        afterMinutes:
          input.afterMinutes ??
          existing?.afterMinutes ??
          config.defaultAfterMinutes,
      };
      if (row.beforeMinutes < 0 || row.afterMinutes < 0) {
        throw new AppError('buffers must be >= 0', ErrorCode.BAD_REQUEST);
      }
      policies.set(row.id, row);
      return row;
    },
    auditAction: 'data.updated',
    auditResource: 'sch_buffer_policy',
    meterEventType: 'api_call',
  });
}

export async function setTravelTime(
  tenantId: string,
  actorId: string,
  input: {
    fromLocationId: string;
    toLocationId: string;
    travelMinutes: number;
  },
): Promise<TravelPair> {
  return runCrudOperation({
    configName: 'buffer-travel-rules',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!input.fromLocationId?.trim() || !input.toLocationId?.trim()) {
        throw new AppError(
          'fromLocationId and toLocationId required',
          ErrorCode.BAD_REQUEST,
        );
      }
      if (
        typeof input.travelMinutes !== 'number' ||
        input.travelMinutes < 0
      ) {
        throw new AppError('travelMinutes must be >= 0', ErrorCode.BAD_REQUEST);
      }
      const k = travelKey(
        tenantId,
        input.fromLocationId,
        input.toLocationId,
      );
      const existingId = [...travel.values()].find(
        (t) =>
          t.tenantId === tenantId &&
          t.fromLocationId === input.fromLocationId &&
          t.toLocationId === input.toLocationId,
      )?.id;
      const row: TravelPair = {
        id: existingId || crypto.randomUUID(),
        tenantId,
        fromLocationId: input.fromLocationId,
        toLocationId: input.toLocationId,
        travelMinutes: input.travelMinutes,
      };
      travel.set(row.id, row);
      // also index by key for quick lookup via scan
      return row;
    },
    auditAction: 'data.updated',
    auditResource: 'sch_travel_pair',
    meterEventType: 'api_call',
  });
}

function lookupTravel(
  tenantId: string,
  fromLocationId: string | undefined,
  toLocationId: string | undefined,
  defaultTravel: number,
): number {
  if (!fromLocationId || !toLocationId || fromLocationId === toLocationId) {
    return 0;
  }
  const pair = [...travel.values()].find(
    (t) =>
      t.tenantId === tenantId &&
      t.fromLocationId === fromLocationId &&
      t.toLocationId === toLocationId,
  );
  return pair?.travelMinutes ?? defaultTravel;
}

function lookupBuffers(
  tenantId: string,
  resourceId: string,
  defaults: { before: number; after: number },
): { beforeMinutes: number; afterMinutes: number } {
  const p = [...policies.values()].find(
    (x) => x.tenantId === tenantId && x.resourceId === resourceId,
  );
  return {
    beforeMinutes: p?.beforeMinutes ?? defaults.before,
    afterMinutes: p?.afterMinutes ?? defaults.after,
  };
}

export async function computeEffectiveWindow(
  tenantId: string,
  actorId: string,
  input: {
    resourceId: string;
    startAt: string;
    endAt: string;
    previousLocationId?: string;
    locationId?: string;
  },
): Promise<EffectiveWindow> {
  return runCrudOperation({
    configName: 'buffer-travel-rules',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('buffer-travel-rules', ConfigSchema);
      const start = Date.parse(input.startAt);
      const end = Date.parse(input.endAt);
      if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
        throw new AppError('invalid time range', ErrorCode.BAD_REQUEST);
      }
      const buf = lookupBuffers(tenantId, input.resourceId, {
        before: config.defaultBeforeMinutes,
        after: config.defaultAfterMinutes,
      });
      const travelMinutes = lookupTravel(
        tenantId,
        input.previousLocationId,
        input.locationId,
        config.defaultTravelMinutes,
      );
      const effectiveStart =
        start - (buf.beforeMinutes + travelMinutes) * 60_000;
      const effectiveEnd = end + buf.afterMinutes * 60_000;
      return {
        startAt: new Date(effectiveStart).toISOString(),
        endAt: new Date(effectiveEnd).toISOString(),
        beforeMinutes: buf.beforeMinutes,
        afterMinutes: buf.afterMinutes,
        travelMinutes,
      };
    },
    auditAction: 'data.read',
    auditResource: 'sch_buffer_policy',
    meterEventType: 'api_call',
  });
}

export async function assertFitsWithBuffers(
  tenantId: string,
  actorId: string,
  input: {
    resourceId: string;
    startAt: string;
    endAt: string;
    previousEndAt?: string;
    previousLocationId?: string;
    locationId?: string;
  },
): Promise<{ ok: boolean; effective: EffectiveWindow }> {
  return runCrudOperation({
    configName: 'buffer-travel-rules',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      // inline compute without nested runCrud
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('buffer-travel-rules', ConfigSchema);
      const start = Date.parse(input.startAt);
      const end = Date.parse(input.endAt);
      if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
        throw new AppError('invalid time range', ErrorCode.BAD_REQUEST);
      }
      const buf = lookupBuffers(tenantId, input.resourceId, {
        before: config.defaultBeforeMinutes,
        after: config.defaultAfterMinutes,
      });
      const travelMinutes = lookupTravel(
        tenantId,
        input.previousLocationId,
        input.locationId,
        config.defaultTravelMinutes,
      );
      const effective: EffectiveWindow = {
        startAt: new Date(
          start - (buf.beforeMinutes + travelMinutes) * 60_000,
        ).toISOString(),
        endAt: new Date(end + buf.afterMinutes * 60_000).toISOString(),
        beforeMinutes: buf.beforeMinutes,
        afterMinutes: buf.afterMinutes,
        travelMinutes,
      };
      if (input.previousEndAt) {
        const prevEnd = Date.parse(input.previousEndAt);
        if (Number.isNaN(prevEnd)) {
          throw new AppError('invalid previousEndAt', ErrorCode.BAD_REQUEST);
        }
        if (Date.parse(effective.startAt) < prevEnd) {
          throw new AppError(
            'Does not fit: buffer/travel overlaps previous appointment',
            ErrorCode.CONFLICT,
          );
        }
      }
      return { ok: true, effective };
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'sch_buffer_policy',
    meterEventType: 'api_call',
  });
}
