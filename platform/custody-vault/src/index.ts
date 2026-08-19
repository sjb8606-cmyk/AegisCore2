/**
 * platform/custody-vault
 *
 * Golden Key · Layer 1 custody core
 *
 * Responsibilities:
 *   - createVault
 *   - depositAsset  (hash → encrypt envelope → store pointer → ledger event)
 *   - sealVault / sealAsset
 *   - getVault / listAssets (metadata only)
 *   - append custody_events via @platform/hash-chain
 *
 * Non-goals for this file:
 *   - Object storage I/O (caller supplies storage_key + encrypted envelope)
 *   - Multi-party / estate policies
 *   - Recovery ceremonies
 *   - PQC
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { enforceQuota } from '@platform/quota-guard';
import { withTenantQuery } from '@platform/tenancy';
import {
  computeChainHash,
  GENESIS_HASH,
} from '@platform/hash-chain';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('custody-vault');

// ── Config ───────────────────────────────────────────────────

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  limits: z.object({
    vaultsPerTenant: z.number().int().positive().default(50),
    assetsPerVault: z.number().int().positive().default(10_000),
  }).default({}),
});

export type CustodyVaultConfig = z.infer<typeof ConfigSchema>;

// ── Types ────────────────────────────────────────────────────

export type VaultState = 'open' | 'sealed' | 'released' | 'archived' | 'destroyed';
export type AssetState = 'open' | 'sealed' | 'released' | 'destroyed';

export interface Vault {
  id: string;
  tenantId: string;
  ownerId: string;
  name: string;
  description: string | null;
  state: VaultState;
  policy: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  sealedAt: string | null;
  releasedAt: string | null;
  destroyedAt: string | null;
}

export interface Asset {
  id: string;
  tenantId: string;
  vaultId: string;
  name: string;
  contentType: string | null;
  byteSize: number | null;
  contentHash: string;
  encryptedEnvelope: Record<string, unknown>;
  storageKey: string;
  state: AssetState;
  createdAt: string;
  updatedAt: string;
  sealedAt: string | null;
  destroyedAt: string | null;
}

export interface CustodyEvent {
  id: string;
  tenantId: string;
  scopeId: string;
  vaultId: string | null;
  assetId: string | null;
  eventType: string;
  actorId: string;
  actorType: string;
  payload: Record<string, unknown>;
  previousHash: string;
  eventHash: string;
  createdAt: string;
}

export interface CreateVaultInput {
  name: string;
  description?: string;
  policy?: Record<string, unknown>;
}

export interface DepositAssetInput {
  vaultId: string;
  name: string;
  contentType?: string;
  byteSize?: number;
  /** SHA-256 hex of plaintext (64 chars) */
  contentHash: string;
  /** KMS envelope metadata from @platform/security encryptField */
  encryptedEnvelope: Record<string, unknown>;
  /** Object-storage pointer — payload is NOT stored in DB */
  storageKey: string;
}

// ── Row mappers ──────────────────────────────────────────────

function mapVault(row: any): Vault {
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

function mapAsset(row: any): Asset {
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

// ── Hash-chained event append ────────────────────────────────

async function appendCustodyEvent(opts: {
  tenantId: string;
  scopeId: string;
  vaultId?: string;
  assetId?: string;
  eventType: string;
  actorId: string;
  actorType?: 'user' | 'service' | 'system';
  payload: Record<string, unknown>;
}): Promise<CustodyEvent> {
  // Read last event hash for this scope (or GENESIS)
  const tail = await withTenantQuery<{ event_hash: string }>(
    `SELECT event_hash FROM custody_events
     WHERE tenant_id = $1 AND scope_id = $2
     ORDER BY created_at DESC
     LIMIT 1`,
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
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      id,
      opts.tenantId,
      opts.scopeId,
      opts.vaultId ?? null,
      opts.assetId ?? null,
      opts.eventType,
      opts.actorId,
      opts.actorType ?? 'user',
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

// ── createVault ──────────────────────────────────────────────

export async function createVault(
  tenantId: string,
  actorId: string,
  input: CreateVaultInput,
): Promise<{ vault: Vault; event: CustodyEvent }> {
  if (!input.name?.trim()) {
    throw new AppError('Vault name is required', ErrorCode.BAD_REQUEST);
  }

  return runCrudOperation({
    configName: 'custody-vault',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    checkQuota: async (config) => {
      const countRes = await withTenantQuery<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM custody_vaults WHERE tenant_id = $1`,
        [tenantId],
        tenantId,
      );
      enforceQuota(
        Number(countRes[0]?.count ?? 0),
        config.limits.vaultsPerTenant,
        `Vault limit reached (${config.limits.vaultsPerTenant} per tenant)`,
      );
    },
    action: async () => {
      const id = crypto.randomUUID();
      const rows = await withTenantQuery<any>(
        `INSERT INTO custody_vaults (
           id, tenant_id, owner_id, name, description, state, policy
         ) VALUES ($1,$2,$3,$4,$5,'open',$6)
         RETURNING *`,
        [
          id,
          tenantId,
          actorId,
          input.name.trim(),
          input.description ?? null,
          JSON.stringify(input.policy ?? {}),
        ],
        tenantId,
      );

      const vault = mapVault(rows[0]);

      const event = await appendCustodyEvent({
        tenantId,
        scopeId: vault.id,
        vaultId: vault.id,
        eventType: 'vault.created',
        actorId,
        payload: { name: vault.name, state: vault.state },
      });

      logger.info({ vaultId: vault.id, tenantId }, 'Vault created');
      return { vault, event };
    },
    auditAction: 'data.created',
    auditResource: 'custody_vault',
    meterEventType: 'api_call',
  });
}

// ── depositAsset ─────────────────────────────────────────────

export async function depositAsset(
  tenantId: string,
  actorId: string,
  input: DepositAssetInput,
): Promise<{ asset: Asset; event: CustodyEvent }> {
  if (!input.vaultId) throw new AppError('vaultId is required', ErrorCode.BAD_REQUEST);
  if (!input.name?.trim()) throw new AppError('Asset name is required', ErrorCode.BAD_REQUEST);
  if (!/^[0-9a-f]{64}$/i.test(input.contentHash)) {
    throw new AppError('contentHash must be 64-char SHA-256 hex', ErrorCode.BAD_REQUEST);
  }
  if (!input.storageKey) throw new AppError('storageKey is required', ErrorCode.BAD_REQUEST);
  if (!input.encryptedEnvelope || typeof input.encryptedEnvelope !== 'object') {
    throw new AppError('encryptedEnvelope is required', ErrorCode.BAD_REQUEST);
  }

  return runCrudOperation({
    configName: 'custody-vault',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    checkQuota: async (config) => {
      const countRes = await withTenantQuery<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM custody_assets
         WHERE tenant_id = $1 AND vault_id = $2`,
        [tenantId, input.vaultId],
        tenantId,
      );
      enforceQuota(
        Number(countRes[0]?.count ?? 0),
        config.limits.assetsPerVault,
        `Asset limit reached (${config.limits.assetsPerVault} per vault)`,
      );
    },
    action: async () => {
      // Vault must exist and be open
      const vaultRows = await withTenantQuery<any>(
        `SELECT id, state FROM custody_vaults WHERE id = $1 AND tenant_id = $2`,
        [input.vaultId, tenantId],
        tenantId,
      );
      if (!vaultRows[0]) throw new AppError('Vault not found', ErrorCode.NOT_FOUND);
      if (vaultRows[0].state !== 'open') {
        throw new AppError(
          `Cannot deposit into vault in state '${vaultRows[0].state}'`,
          ErrorCode.FORBIDDEN,
        );
      }

      const id = crypto.randomUUID();
      const rows = await withTenantQuery<any>(
        `INSERT INTO custody_assets (
           id, tenant_id, vault_id, name, content_type, byte_size,
           content_hash, encrypted_envelope, storage_key, state
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'open')
         RETURNING *`,
        [
          id,
          tenantId,
          input.vaultId,
          input.name.trim(),
          input.contentType ?? null,
          input.byteSize ?? null,
          input.contentHash.toLowerCase(),
          JSON.stringify(input.encryptedEnvelope),
          input.storageKey,
        ],
        tenantId,
      );

      const asset = mapAsset(rows[0]);

      const event = await appendCustodyEvent({
        tenantId,
        scopeId: input.vaultId,
        vaultId: input.vaultId,
        assetId: asset.id,
        eventType: 'asset.deposited',
        actorId,
        payload: {
          assetId: asset.id,
          name: asset.name,
          contentHash: asset.contentHash,
          byteSize: asset.byteSize,
        },
      });

      logger.info(
        { vaultId: input.vaultId, assetId: asset.id, contentHash: asset.contentHash },
        'Asset deposited',
      );
      return { asset, event };
    },
    auditAction: 'data.created',
    auditResource: 'custody_asset',
    meterEventType: 'api_call',
  });
}

// ── sealVault ────────────────────────────────────────────────

export async function sealVault(
  tenantId: string,
  actorId: string,
  vaultId: string,
): Promise<{ vault: Vault; event: CustodyEvent }> {
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
      if (existing[0].state === 'sealed') {
        throw new AppError('Vault is already sealed', ErrorCode.CONFLICT);
      }
      if (existing[0].state !== 'open') {
        throw new AppError(
          `Cannot seal vault in state '${existing[0].state}'`,
          ErrorCode.FORBIDDEN,
        );
      }

      const rows = await withTenantQuery<any>(
        `UPDATE custody_vaults
         SET state = 'sealed', sealed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND tenant_id = $2
         RETURNING *`,
        [vaultId, tenantId],
        tenantId,
      );

      // Also seal all open assets in this vault
      await withTenantQuery(
        `UPDATE custody_assets
         SET state = 'sealed', sealed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE vault_id = $1 AND tenant_id = $2 AND state = 'open'`,
        [vaultId, tenantId],
        tenantId,
      );

      const vault = mapVault(rows[0]);

      const event = await appendCustodyEvent({
        tenantId,
        scopeId: vaultId,
        vaultId,
        eventType: 'vault.sealed',
        actorId,
        payload: { previousState: 'open', newState: 'sealed' },
      });

      logger.info({ vaultId }, 'Vault sealed');
      return { vault, event };
    },
    auditAction: 'data.updated',
    auditResource: 'custody_vault',
    auditResourceId: vaultId,
    meterEventType: 'api_call',
  });
}

// ── sealAsset ────────────────────────────────────────────────

export async function sealAsset(
  tenantId: string,
  actorId: string,
  assetId: string,
): Promise<{ asset: Asset; event: CustodyEvent }> {
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
      if (existing[0].state === 'sealed') {
        throw new AppError('Asset is already sealed', ErrorCode.CONFLICT);
      }
      if (existing[0].state !== 'open') {
        throw new AppError(
          `Cannot seal asset in state '${existing[0].state}'`,
          ErrorCode.FORBIDDEN,
        );
      }

      const rows = await withTenantQuery<any>(
        `UPDATE custody_assets
         SET state = 'sealed', sealed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND tenant_id = $2
         RETURNING *`,
        [assetId, tenantId],
        tenantId,
      );

      const asset = mapAsset(rows[0]);

      const event = await appendCustodyEvent({
        tenantId,
        scopeId: asset.vaultId,
        vaultId: asset.vaultId,
        assetId: asset.id,
        eventType: 'asset.sealed',
        actorId,
        payload: {
          assetId: asset.id,
          contentHash: asset.contentHash,
          previousState: 'open',
          newState: 'sealed',
        },
      });

      logger.info({ assetId, vaultId: asset.vaultId }, 'Asset sealed');
      return { asset, event };
    },
    auditAction: 'data.updated',
    auditResource: 'custody_asset',
    auditResourceId: assetId,
    meterEventType: 'api_call',
  });
}

// ── Reads (metadata only — never returns decryptable material beyond envelope) ──

export async function getVault(
  tenantId: string,
  vaultId: string,
): Promise<Vault | null> {
  const rows = await withTenantQuery<any>(
    `SELECT * FROM custody_vaults WHERE id = $1 AND tenant_id = $2`,
    [vaultId, tenantId],
    tenantId,
  );
  return rows[0] ? mapVault(rows[0]) : null;
}

export async function listAssets(
  tenantId: string,
  vaultId: string,
): Promise<Asset[]> {
  const rows = await withTenantQuery<any>(
    `SELECT * FROM custody_assets
     WHERE tenant_id = $1 AND vault_id = $2
     ORDER BY created_at ASC`,
    [tenantId, vaultId],
    tenantId,
  );
  return rows.map(mapAsset);
}

export async function getAsset(
  tenantId: string,
  assetId: string,
): Promise<Asset | null> {
  const rows = await withTenantQuery<any>(
    `SELECT * FROM custody_assets WHERE id = $1 AND tenant_id = $2`,
    [assetId, tenantId],
    tenantId,
  );
  return rows[0] ? mapAsset(rows[0]) : null;
}
