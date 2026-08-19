/**
 * platform/custody-vault/src/release.ts
 *
 * Release operations: sealed → released
 *
 * "Release" means authorized transition out of sealed custody so a
 * controlled retrieve workflow can proceed. It does NOT decrypt.
 * It does NOT destroy. It records a custody event on the hash chain.
 *
 * Destroyed / archived states are rejected.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { withTenantQuery } from '@platform/tenancy';
import { computeChainHash, GENESIS_HASH } from '@platform/hash-chain';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('custody-vault:release');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  limits: z.object({
    vaultsPerTenant: z.number().int().positive().default(50),
    assetsPerVault: z.number().int().positive().default(10_000),
  }).default({}),
});

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

/**
 * Release a sealed vault → released.
 * Cascades to sealed assets in that vault (sealed → released).
 */
export async function releaseVault(
  tenantId: string,
  actorId: string,
  vaultId: string,
  reason?: string,
) {
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

      const state = existing[0].state as string;
      if (state === 'released') {
        throw new AppError('Vault is already released', ErrorCode.CONFLICT);
      }
      if (state !== 'sealed') {
        throw new AppError(
          `Cannot release vault in state '${state}' (must be sealed)`,
          ErrorCode.FORBIDDEN,
        );
      }

      const rows = await withTenantQuery<any>(
        `UPDATE custody_vaults
         SET state = 'released',
             released_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND tenant_id = $2
         RETURNING *`,
        [vaultId, tenantId],
        tenantId,
      );

      await withTenantQuery(
        `UPDATE custody_assets
         SET state = 'released', updated_at = CURRENT_TIMESTAMP
         WHERE vault_id = $1 AND tenant_id = $2 AND state = 'sealed'`,
        [vaultId, tenantId],
        tenantId,
      );

      const vault = mapVault(rows[0]);
      const event = await appendEvent({
        tenantId,
        scopeId: vaultId,
        vaultId,
        eventType: 'vault.released',
        actorId,
        payload: {
          previousState: 'sealed',
          newState: 'released',
          reason: reason ?? null,
        },
      });

      logger.info({ vaultId, reason }, 'Vault released');
      return { vault, event };
    },
    auditAction: 'data.updated',
    auditResource: 'custody_vault',
    auditResourceId: vaultId,
    meterEventType: 'api_call',
  });
}

/**
 * Release a single sealed asset → released.
 */
export async function releaseAsset(
  tenantId: string,
  actorId: string,
  assetId: string,
  reason?: string,
) {
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

      const state = existing[0].state as string;
      if (state === 'released') {
        throw new AppError('Asset is already released', ErrorCode.CONFLICT);
      }
      if (state !== 'sealed') {
        throw new AppError(
          `Cannot release asset in state '${state}' (must be sealed)`,
          ErrorCode.FORBIDDEN,
        );
      }

      const rows = await withTenantQuery<any>(
        `UPDATE custody_assets
         SET state = 'released', updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND tenant_id = $2
         RETURNING *`,
        [assetId, tenantId],
        tenantId,
      );

      const asset = mapAsset(rows[0]);
      const event = await appendEvent({
        tenantId,
        scopeId: asset.vaultId,
        vaultId: asset.vaultId,
        assetId: asset.id,
        eventType: 'asset.released',
        actorId,
        payload: {
          assetId: asset.id,
          contentHash: asset.contentHash,
          previousState: 'sealed',
          newState: 'released',
          reason: reason ?? null,
        },
      });

      logger.info({ assetId, vaultId: asset.vaultId, reason }, 'Asset released');
      return { asset, event };
    },
    auditAction: 'data.updated',
    auditResource: 'custody_asset',
    auditResourceId: assetId,
    meterEventType: 'api_call',
  });
}
