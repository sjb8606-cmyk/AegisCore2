/**
 * platform/custody-vault/src/destroy.ts
 *
 * Destroy operations — irreversible end of active custody.
 *
 * Semantics:
 * - State becomes `destroyed`
 * - storage_key / encrypted_envelope are wiped from the row
 *   (caller must also delete the object-store blob; this core
 *    records intent and clears DB pointers)
 * - content_hash is RETAINED for provenance
 * - custody_events are NEVER deleted (append-only ledger)
 * - Allowed from: open | sealed | released
 * - Not allowed from: already destroyed
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { withTenantQuery } from '@platform/tenancy';
import { computeChainHash, GENESIS_HASH } from '@platform/hash-chain';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('custody-vault:destroy');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  limits: z.object({
    vaultsPerTenant: z.number().int().positive().default(50),
    assetsPerVault: z.number().int().positive().default(10_000),
  }).default({}),
});

const DESTRUCTIBLE = new Set(['open', 'sealed', 'released']);

async function appendEvent(opts: {
  tenantId: string;
  scopeId: string;
  vaultId?: string;
  assetId?: string;
  eventType: string;
  actorId: string;
  payload: Record<string, unknown>;
}) {
  const tail = await withTenantQuery<{ event_hash: string }>(
    `SELECT event_hash FROM custody_events
     WHERE tenant_id = $1 AND scope_id = $2
     ORDER BY created_at DESC LIMIT 1`,
    [opts.tenantId, opts.scopeId],
    opts.tenantId,
  );
  const previousHash = tail[0]?.event_hash ?? GENESIS_HASH;
  const eventHash = computeChainHash(
    opts.scopeId,
    opts.eventType,
    opts.payload,
    previousHash,
  );
  const id = crypto.randomUUID();
  const rows = await withTenantQuery<any>(
    `INSERT INTO custody_events (
       id, tenant_id, scope_id, vault_id, asset_id,
       event_type, actor_id, actor_type, payload,
       previous_hash, event_hash
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,'user',$8,$9,$10)
     RETURNING *`,
    [
      id,
      opts.tenantId,
      opts.scopeId,
      opts.vaultId ?? null,
      opts.assetId ?? null,
      opts.eventType,
      opts.actorId,
      JSON.stringify(opts.payload),
      previousHash,
      eventHash,
    ],
    opts.tenantId,
  );
  const row = rows[0];
  return {
    id: row.id,
    tenantId: row.tenant_id,
    scopeId: row.scope_id,
    vaultId: row.vault_id,
    assetId: row.asset_id,
    eventType: row.event_type,
    actorId: row.actor_id,
    actorType: row.actor_type,
    payload: row.payload,
    previousHash: row.previous_hash,
    eventHash: row.event_hash,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function mapVault(row: any) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    ownerId: row.owner_id,
    name: row.name,
    description: row.description ?? null,
    state: row.state,
    policy: row.policy ?? {},
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    sealedAt: row.sealed_at ? new Date(row.sealed_at).toISOString() : null,
    releasedAt: row.released_at ? new Date(row.released_at).toISOString() : null,
    destroyedAt: row.destroyed_at ? new Date(row.destroyed_at).toISOString() : null,
  };
}

function mapAsset(row: any) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    vaultId: row.vault_id,
    name: row.name,
    contentType: row.content_type ?? null,
    byteSize: row.byte_size != null ? Number(row.byte_size) : null,
    contentHash: row.content_hash,
    encryptedEnvelope: row.encrypted_envelope,
    storageKey: row.storage_key,
    state: row.state,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    sealedAt: row.sealed_at ? new Date(row.sealed_at).toISOString() : null,
    destroyedAt: row.destroyed_at ? new Date(row.destroyed_at).toISOString() : null,
  };
}

export interface DestroyResult {
  /** Storage keys that the caller MUST delete from object storage */
  storageKeysToDelete: string[];
}

/**
 * Destroy a single asset.
 * Returns storage keys the caller is responsible for deleting externally.
 */
export async function destroyAsset(
  tenantId: string,
  actorId: string,
  assetId: string,
  reason?: string,
): Promise<{ asset: ReturnType<typeof mapAsset>; event: any; storageKeysToDelete: string[] }> {
  return runCrudOperation({
    configName: 'custody-vault',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const existing = await withTenantQuery<any>(
        `SELECT * FROM custody_assets WHERE id = $1 AND tenant_id = $2`,
        [assetId, tenantId],
        tenantId,
      );
      if (!existing[0]) throw new AppError('Asset not found', ErrorCode.NOT_FOUND);

      const prev = existing[0].state as string;
      if (prev === 'destroyed') {
        throw new AppError('Asset is already destroyed', ErrorCode.CONFLICT);
      }
      if (!DESTRUCTIBLE.has(prev)) {
        throw new AppError(
          `Cannot destroy asset in state '${prev}'`,
          ErrorCode.FORBIDDEN,
        );
      }

      const storageKey = existing[0].storage_key as string;
      const contentHash = existing[0].content_hash as string;
      const vaultId = existing[0].vault_id as string;

      const rows = await withTenantQuery<any>(
        `UPDATE custody_assets
         SET state = 'destroyed',
             destroyed_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP,
             storage_key = '',
             encrypted_envelope = '{}'::jsonb
         WHERE id = $1 AND tenant_id = $2
         RETURNING *`,
        [assetId, tenantId],
        tenantId,
      );

      const asset = mapAsset(rows[0]);
      const event = await appendEvent({
        tenantId,
        scopeId: vaultId,
        vaultId,
        assetId,
        eventType: 'asset.destroyed',
        actorId,
        payload: {
          assetId,
          contentHash,
          previousState: prev,
          newState: 'destroyed',
          reason: reason ?? null,
          storageKeyCleared: true,
        },
      });

      logger.info({ assetId, vaultId, contentHash }, 'Asset destroyed');
      return { asset, event, storageKeysToDelete: storageKey ? [storageKey] : [] };
    },
    auditAction: 'data.deleted',
    auditResource: 'custody_asset',
    auditResourceId: assetId,
    meterEventType: 'api_call',
  });
}

/**
 * Destroy an entire vault and all non-destroyed assets inside it.
 * Returns all storage keys the caller must delete externally.
 */
export async function destroyVault(
  tenantId: string,
  actorId: string,
  vaultId: string,
  reason?: string,
): Promise<{ vault: ReturnType<typeof mapVault>; event: any; storageKeysToDelete: string[] }> {
  return runCrudOperation({
    configName: 'custody-vault',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const existing = await withTenantQuery<any>(
        `SELECT * FROM custody_vaults WHERE id = $1 AND tenant_id = $2`,
        [vaultId, tenantId],
        tenantId,
      );
      if (!existing[0]) throw new AppError('Vault not found', ErrorCode.NOT_FOUND);

      const prev = existing[0].state as string;
      if (prev === 'destroyed') {
        throw new AppError('Vault is already destroyed', ErrorCode.CONFLICT);
      }
      if (!DESTRUCTIBLE.has(prev)) {
        throw new AppError(
          `Cannot destroy vault in state '${prev}'`,
          ErrorCode.FORBIDDEN,
        );
      }

      // Collect storage keys before wipe
      const assetRows = await withTenantQuery<{ id: string; storage_key: string; state: string }>(
        `SELECT id, storage_key, state FROM custody_assets
         WHERE tenant_id = $1 AND vault_id = $2 AND state != 'destroyed'`,
        [tenantId, vaultId],
        tenantId,
      );
      const storageKeysToDelete = assetRows
        .map((a) => a.storage_key)
        .filter((k) => !!k);

      // Wipe all child assets
      await withTenantQuery(
        `UPDATE custody_assets
         SET state = 'destroyed',
             destroyed_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP,
             storage_key = '',
             encrypted_envelope = '{}'::jsonb
         WHERE tenant_id = $1 AND vault_id = $2 AND state != 'destroyed'`,
        [tenantId, vaultId],
        tenantId,
      );

      const rows = await withTenantQuery<any>(
        `UPDATE custody_vaults
         SET state = 'destroyed',
             destroyed_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND tenant_id = $2
         RETURNING *`,
        [vaultId, tenantId],
        tenantId,
      );

      const vault = mapVault(rows[0]);
      const event = await appendEvent({
        tenantId,
        scopeId: vaultId,
        vaultId,
        eventType: 'vault.destroyed',
        actorId,
        payload: {
          previousState: prev,
          newState: 'destroyed',
          reason: reason ?? null,
          assetsDestroyed: assetRows.length,
        },
      });

      logger.info(
        { vaultId, assetsDestroyed: assetRows.length },
        'Vault destroyed',
      );
      return { vault, event, storageKeysToDelete };
    },
    auditAction: 'data.deleted',
    auditResource: 'custody_vault',
    auditResourceId: vaultId,
    meterEventType: 'api_call',
  });
}
