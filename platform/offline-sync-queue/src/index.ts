/**
 * platform/offline-sync-queue
 *
 * Client writes locally → queue → sync on reconnect with idempotency + conflict strategy.
 * Server-side store simulates the durable queue; real device storage plugs in later.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('offline-sync-queue');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  conflictStrategy: z.enum(['last_write_wins', 'merge', 'reject']).default('last_write_wins'),
  maxRetries: z.number().int().nonnegative().default(5),
  offlineEntities: z.array(z.string()).default(['*']),
  retryBackoffMs: z.number().int().positive().default(1000),
});

export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'conflict' | 'failed';

export interface PendingWrite {
  id: string;
  tenantId: string;
  clientId: string;
  entity: string;
  entityId: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  createdAt: string;
  clientTimestamp: string;
  syncStatus: SyncStatus;
  retries: number;
  lastError: string | null;
  serverVersion: number | null;
}

/** Server-side entity snapshot for conflict checks */
export interface ServerEntity {
  tenantId: string;
  entity: string;
  entityId: string;
  data: Record<string, unknown>;
  version: number;
  updatedAt: string;
}

const queue = new Map<string, PendingWrite>();
const server = new Map<string, ServerEntity>(); // key tenant:entity:entityId
const seenIdempotency = new Set<string>();

export function __resetOfflineSyncStore(): void {
  queue.clear();
  server.clear();
  seenIdempotency.clear();
}

function sk(tenantId: string, entity: string, entityId: string): string {
  return tenantId + ':' + entity + ':' + entityId;
}

async function loadCfg() {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('offline-sync-queue', ConfigSchema);
}

export function isOfflineCapable(entity: string, offlineEntities: string[]): boolean {
  return offlineEntities.includes('*') || offlineEntities.includes(entity);
}

export async function enqueueWrite(
  tenantId: string,
  actorId: string,
  input: {
    clientId: string;
    entity: string;
    entityId: string;
    payload: Record<string, unknown>;
    idempotencyKey: string;
    clientTimestamp?: string;
  },
): Promise<PendingWrite> {
  return runCrudOperation({
    configName: 'offline-sync-queue',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      if (!input.entity || !input.entityId || !input.idempotencyKey) {
        throw new AppError(
          'entity, entityId, idempotencyKey required',
          ErrorCode.BAD_REQUEST,
        );
      }
      if (!isOfflineCapable(input.entity, config.offlineEntities)) {
        throw new AppError(
          'entity not offline-capable',
          ErrorCode.FORBIDDEN,
        );
      }
      // Idempotent replay
      const existing = [...queue.values()].find(
        (w) =>
          w.tenantId === tenantId &&
          w.idempotencyKey === input.idempotencyKey,
      );
      if (existing) return existing;

      const write: PendingWrite = {
        id: crypto.randomUUID(),
        tenantId,
        clientId: input.clientId || actorId,
        entity: input.entity,
        entityId: input.entityId,
        payload: input.payload || {},
        idempotencyKey: input.idempotencyKey,
        createdAt: new Date().toISOString(),
        clientTimestamp: input.clientTimestamp || new Date().toISOString(),
        syncStatus: 'pending',
        retries: 0,
        lastError: null,
        serverVersion: null,
      };
      queue.set(write.id, write);
      return write;
    },
    auditAction: 'data.created',
    auditResource: 'pending_write',
    meterEventType: 'api_call',
  });
}

function applyConflict(
  strategy: 'last_write_wins' | 'merge' | 'reject',
  current: ServerEntity | undefined,
  write: PendingWrite,
): { ok: boolean; data: Record<string, unknown>; conflict: boolean } {
  if (!current) {
    return { ok: true, data: write.payload, conflict: false };
  }
  const clientTs = new Date(write.clientTimestamp).getTime();
  const serverTs = new Date(current.updatedAt).getTime();

  if (strategy === 'reject' && serverTs > clientTs) {
    return { ok: false, data: current.data, conflict: true };
  }
  if (strategy === 'merge') {
    return {
      ok: true,
      data: { ...current.data, ...write.payload },
      conflict: false,
    };
  }
  // last_write_wins — client wins if clientTimestamp >= server
  if (clientTs >= serverTs) {
    return { ok: true, data: write.payload, conflict: false };
  }
  return { ok: true, data: current.data, conflict: true };
}

export async function syncPending(
  tenantId: string,
  actorId: string,
  input?: { clientId?: string; limit?: number },
): Promise<{ synced: number; conflicts: number; failed: number }> {
  return runCrudOperation({
    configName: 'offline-sync-queue',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      const pending = [...queue.values()]
        .filter(
          (w) =>
            w.tenantId === tenantId &&
            (w.syncStatus === 'pending' || w.syncStatus === 'failed') &&
            (!input?.clientId || w.clientId === input.clientId) &&
            w.retries <= config.maxRetries,
        )
        .sort(
          (a, b) =>
            new Date(a.clientTimestamp).getTime() -
            new Date(b.clientTimestamp).getTime(),
        )
        .slice(0, input?.limit ?? 100);

      let synced = 0;
      let conflicts = 0;
      let failed = 0;

      for (const write of pending) {
        write.syncStatus = 'syncing';
        queue.set(write.id, write);

        // Server-side idempotency
        if (seenIdempotency.has(tenantId + ':' + write.idempotencyKey)) {
          write.syncStatus = 'synced';
          queue.set(write.id, write);
          synced++;
          continue;
        }

        try {
          const key = sk(tenantId, write.entity, write.entityId);
          const current = server.get(key);
          const result = applyConflict(
            config.conflictStrategy,
            current,
            write,
          );

          if (!result.ok) {
            write.syncStatus = 'conflict';
            write.lastError = 'rejected by conflict strategy';
            queue.set(write.id, write);
            conflicts++;
            continue;
          }

          const version = (current?.version || 0) + 1;
          server.set(key, {
            tenantId,
            entity: write.entity,
            entityId: write.entityId,
            data: result.data,
            version,
            updatedAt: write.clientTimestamp,
          });
          seenIdempotency.add(tenantId + ':' + write.idempotencyKey);
          write.serverVersion = version;
          write.syncStatus = result.conflict ? 'conflict' : 'synced';
          // last_write_wins still applies server data; mark conflict if client lost
          if (result.conflict && config.conflictStrategy === 'last_write_wins') {
            // server kept its data — client write discarded
            conflicts++;
          } else if (!result.conflict) {
            synced++;
          } else {
            conflicts++;
          }
          write.syncStatus = result.conflict ? 'conflict' : 'synced';
          queue.set(write.id, write);
        } catch (err: any) {
          write.retries += 1;
          write.lastError = String(err?.message || err);
          write.syncStatus =
            write.retries > config.maxRetries ? 'failed' : 'pending';
          queue.set(write.id, write);
          failed++;
        }
      }

      logger.info({ synced, conflicts, failed }, 'Sync batch complete');
      return { synced, conflicts, failed };
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'sync_batch',
    meterEventType: 'api_call',
  });
}

export async function listPending(
  tenantId: string,
  clientId?: string,
): Promise<PendingWrite[]> {
  return [...queue.values()].filter(
    (w) =>
      w.tenantId === tenantId &&
      w.syncStatus === 'pending' &&
      (!clientId || w.clientId === clientId),
  );
}

export async function getServerEntity(
  tenantId: string,
  entity: string,
  entityId: string,
): Promise<ServerEntity | null> {
  return server.get(sk(tenantId, entity, entityId)) || null;
}

export async function seedServerEntity(
  tenantId: string,
  entity: string,
  entityId: string,
  data: Record<string, unknown>,
  updatedAt?: string,
): Promise<void> {
  const key = sk(tenantId, entity, entityId);
  const prev = server.get(key);
  server.set(key, {
    tenantId,
    entity,
    entityId,
    data,
    version: (prev?.version || 0) + 1,
    updatedAt: updatedAt || new Date().toISOString(),
  });
}
