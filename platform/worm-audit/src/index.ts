/**
 * platform/worm-audit
 *
 * Append-only audit log. No public update/delete API.
 * DB RULES (no_update / no_delete) live in the migration.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { computeChainHash, GENESIS_HASH } from '@platform/hash-chain';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('worm-audit');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
});

export interface WormAuditEntry {
  id: string;
  tenantId: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  changes: Record<string, unknown>;
  chainHash: string;
  previousHash: string;
  timestamp: string;
}

const entries = new Map<string, WormAuditEntry>();
const byEntity = new Map<string, string[]>(); // `\( {entityType}: \){entityId}` → ids
const chainTips = new Map<string, string>();

export function __resetWormAuditStore(): void {
  entries.clear();
  byEntity.clear();
  chainTips.clear();
}

/**
 * Server-side write only — other cores call this.
 * Not exposed as a public HTTP write route.
 */
export async function appendAudit(
  tenantId: string,
  actorId: string,
  input: {
    action: string;
    entityType: string;
    entityId: string;
    changes?: Record<string, unknown>;
  },
): Promise<WormAuditEntry> {
  return runCrudOperation({
    configName: 'worm-audit',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    actorType: 'service',
    action: async () => {
      if (!input.action || !input.entityType || !input.entityId) {
        throw new AppError(
          'action, entityType, entityId required',
          ErrorCode.BAD_REQUEST,
        );
      }

      const id = crypto.randomUUID();
      const timestamp = new Date().toISOString();
      const previousHash = chainTips.get(tenantId) || GENESIS_HASH;
      const payload = {
        id,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        changes: input.changes || {},
        timestamp,
      };
      const chainHash = computeChainHash(
        tenantId,
        'worm_audit',
        payload,
        previousHash,
      );
      chainTips.set(tenantId, chainHash);

      const entry: WormAuditEntry = {
        id,
        tenantId,
        actorId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        changes: input.changes || {},
        chainHash,
        previousHash,
        timestamp,
      };
      entries.set(id, entry);
      const key = `\( {input.entityType}: \){input.entityId}`;
      const list = byEntity.get(key) || [];
      list.push(id);
      byEntity.set(key, list);

      logger.debug({ auditId: id, action: input.action }, 'WORM audit appended');
      return entry;
    },
    auditAction: 'data.created',
    auditResource: 'worm_audit_log',
    meterEventType: 'api_call',
  });
}

/** Read-only query */
export async function queryAuditLog(
  tenantId: string,
  filter: {
    entityId?: string;
    entityType?: string;
    actorId?: string;
    limit?: number;
  },
): Promise<WormAuditEntry[]> {
  let list = [...entries.values()].filter((e) => e.tenantId === tenantId);

  if (filter.entityId) {
    list = list.filter((e) => e.entityId === filter.entityId);
  }
  if (filter.entityType) {
    list = list.filter((e) => e.entityType === filter.entityType);
  }
  if (filter.actorId) {
    list = list.filter((e) => e.actorId === filter.actorId);
  }

  list.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const limit = filter.limit && filter.limit > 0 ? filter.limit : 200;
  return list.slice(0, limit);
}

export async function getAuditEntry(
  tenantId: string,
  entryId: string,
): Promise<WormAuditEntry | null> {
  const e = entries.get(entryId);
  if (!e || e.tenantId !== tenantId) return null;
  return e;
}
