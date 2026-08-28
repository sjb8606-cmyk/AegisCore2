/**
 * platform/offline-queue-replay (POS-03)
 *
 * Queue POS events while offline; idempotent replay when back online.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('offline-queue-replay');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  maxQueueDepth: z.number().int().positive().default(5000),
  maxAttempts: z.number().int().positive().default(5),
});

export type QueueItemStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'duplicate';

export interface OfflineQueueItem {
  id: string;
  tenantId: string;
  deviceId: string;
  idempotencyKey: string;
  eventType: string;
  payload: Record<string, unknown>;
  status: QueueItemStatus;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  processedAt: string | null;
}

/** Injectable processor for domain application of the event */
type EventProcessor = (
  tenantId: string,
  eventType: string,
  payload: Record<string, unknown>,
) => Promise<void>;

const queue = new Map<string, OfflineQueueItem>();
/** tenant:device:idempotencyKey → item id */
const idemIndex = new Map<string, string>();
let processor: EventProcessor = async () => undefined;

export function __resetOfflineQueueStore(): void {
  queue.clear();
  idemIndex.clear();
  processor = async () => undefined;
}

export function setEventProcessor(fn: EventProcessor): void {
  processor = fn;
}

function idemKey(tenantId: string, deviceId: string, key: string): string {
  return tenantId + ':' + deviceId + ':' + key;
}

export async function enqueueEvent(
  tenantId: string,
  actorId: string,
  input: {
    deviceId: string;
    idempotencyKey: string;
    eventType: string;
    payload: Record<string, unknown>;
  },
): Promise<OfflineQueueItem> {
  return runCrudOperation({
    configName: 'offline-queue-replay',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('offline-queue-replay', ConfigSchema);
      if (!input.deviceId?.trim() || !input.idempotencyKey?.trim()) {
        throw new AppError(
          'deviceId and idempotencyKey required',
          ErrorCode.BAD_REQUEST,
        );
      }
      if (!input.eventType?.trim()) {
        throw new AppError('eventType required', ErrorCode.BAD_REQUEST);
      }
      const ik = idemKey(tenantId, input.deviceId, input.idempotencyKey);
      const existingId = idemIndex.get(ik);
      if (existingId) {
        const existing = queue.get(existingId)!;
        return { ...existing, status: 'duplicate' as QueueItemStatus };
      }
      const depth = [...queue.values()].filter(
        (q) =>
          q.tenantId === tenantId &&
          (q.status === 'queued' || q.status === 'processing'),
      ).length;
      if (depth >= config.maxQueueDepth) {
        throw new AppError('Offline queue full', ErrorCode.CONFLICT);
      }
      const item: OfflineQueueItem = {
        id: crypto.randomUUID(),
        tenantId,
        deviceId: input.deviceId,
        idempotencyKey: input.idempotencyKey,
        eventType: input.eventType.trim(),
        payload: input.payload || {},
        status: 'queued',
        attempts: 0,
        lastError: null,
        createdAt: new Date().toISOString(),
        processedAt: null,
      };
      queue.set(item.id, item);
      idemIndex.set(ik, item.id);
      return item;
    },
    auditAction: 'data.created',
    auditResource: 'pos_offline_event',
    meterEventType: 'api_call',
  });
}

export async function replayQueue(
  tenantId: string,
  actorId: string,
  deviceId?: string,
): Promise<{ completed: number; failed: number; skipped: number }> {
  return runCrudOperation({
    configName: 'offline-queue-replay',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('offline-queue-replay', ConfigSchema);
      const pending = [...queue.values()]
        .filter(
          (q) =>
            q.tenantId === tenantId &&
            q.status === 'queued' &&
            (!deviceId || q.deviceId === deviceId),
        )
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

      let completed = 0;
      let failed = 0;
      let skipped = 0;

      for (const item of pending) {
        if (item.attempts >= config.maxAttempts) {
          item.status = 'failed';
          queue.set(item.id, item);
          failed += 1;
          continue;
        }
        item.status = 'processing';
        item.attempts += 1;
        queue.set(item.id, item);
        try {
          await processor(tenantId, item.eventType, item.payload);
          item.status = 'completed';
          item.processedAt = new Date().toISOString();
          item.lastError = null;
          queue.set(item.id, item);
          completed += 1;
        } catch (err) {
          item.status = 'queued';
          item.lastError = err instanceof Error ? err.message : String(err);
          if (item.attempts >= config.maxAttempts) {
            item.status = 'failed';
            failed += 1;
          } else {
            skipped += 1;
          }
          queue.set(item.id, item);
          logger.warn(
            { itemId: item.id, attempts: item.attempts, error: item.lastError },
            'Offline event replay failed',
          );
        }
      }
      return { completed, failed, skipped };
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'pos_offline_event',
    meterEventType: 'api_call',
  });
}

export async function getQueueStatus(
  tenantId: string,
  actorId: string,
  deviceId?: string,
): Promise<{
  queued: number;
  completed: number;
  failed: number;
  items: OfflineQueueItem[];
}> {
  return runCrudOperation({
    configName: 'offline-queue-replay',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const items = [...queue.values()].filter(
        (q) =>
          q.tenantId === tenantId && (!deviceId || q.deviceId === deviceId),
      );
      return {
        queued: items.filter((i) => i.status === 'queued').length,
        completed: items.filter((i) => i.status === 'completed').length,
        failed: items.filter((i) => i.status === 'failed').length,
        items: items.sort(
          (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
        ),
      };
    },
    auditAction: 'data.read',
    auditResource: 'pos_offline_event',
    meterEventType: 'api_call',
  });
}
