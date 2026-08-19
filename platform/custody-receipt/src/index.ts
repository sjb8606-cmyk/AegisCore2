/**
 * platform/custody-receipt
 *
 * Golden Key · Layer 1 provenance surface
 *
 * - issueVaultReceipt / issueAssetReceipt
 * - verifyReceipt (recompute event chain segment + match hashes)
 * - getAuthorizedAssetView (metadata + storage pointer only — no decrypt)
 *
 * A receipt is a stable, exportable JSON document that asserts:
 *   "This vault/asset existed in this state, with this content hash,
 *    under this tenant, as of this event hash."
 *
 * It does NOT prove legal ownership. It proves custody state inside Golden Key.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { withTenantQuery } from '@platform/tenancy';
import { verifyChain, type ChainEvent } from '@platform/hash-chain';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('custody-receipt');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
});

// ── Receipt types ────────────────────────────────────────────

export interface AssetReceiptSubject {
  assetId: string;
  name: string;
  contentHash: string;
  contentType: string | null;
  byteSize: number | null;
  state: string;
  storageKey: string;
  sealedAt: string | null;
}

export interface VaultReceiptSubject {
  vaultId: string;
  name: string;
  state: string;
  ownerId: string;
  sealedAt: string | null;
  assetCount: number;
}

export interface CustodyReceipt {
  /** Stable receipt id */
  receiptId: string;
  /** vault | asset */
  kind: 'vault' | 'asset';
  tenantId: string;
  issuedAt: string;
  /** Subject snapshot at issue time */
  subject: VaultReceiptSubject | AssetReceiptSubject;
  /** Tip of the custody event chain for this scope at issue time */
  chainTip: {
    scopeId: string;
    eventHash: string;
    eventType: string;
    eventId: string;
    previousHash: string;
  };
  /** SHA-256 of canonical receipt body (excluding receiptHash itself) */
  receiptHash: string;
  /** Schema version for future evolvability */
  version: 1;
}

export interface AuthorizedAssetView {
  assetId: string;
  vaultId: string;
  name: string;
  contentType: string | null;
  byteSize: number | null;
  contentHash: string;
  state: string;
  /** Pointer only — caller must be authorized to fetch blob separately */
  storageKey: string;
  encryptedEnvelope: Record<string, unknown>;
  createdAt: string;
  sealedAt: string | null;
}

// ── Helpers ──────────────────────────────────────────────────

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map((v) => stableStringify(v)).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}

function canonicalHash(value: unknown): string {
  return crypto.createHash('sha256').update(stableStringify(value), 'utf8').digest('hex');
}

async function loadChainTip(
  tenantId: string,
  scopeId: string,
): Promise<{
  eventHash: string;
  eventType: string;
  eventId: string;
  previousHash: string;
} | null> {
  const rows = await withTenantQuery<any>(
    `SELECT id, event_type, event_hash, previous_hash
     FROM custody_events
     WHERE tenant_id = $1 AND scope_id = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [tenantId, scopeId],
    tenantId,
  );
  if (!rows[0]) return null;
  return {
    eventId: rows[0].id,
    eventType: rows[0].event_type,
    eventHash: rows[0].event_hash,
    previousHash: rows[0].previous_hash,
  };
}

// ── issueAssetReceipt ────────────────────────────────────────

export async function issueAssetReceipt(
  tenantId: string,
  actorId: string,
  assetId: string,
): Promise<CustodyReceipt> {
  return runCrudOperation({
    configName: 'custody-receipt',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const rows = await withTenantQuery<any>(
        `SELECT * FROM custody_assets WHERE id = $1 AND tenant_id = $2`,
        [assetId, tenantId],
        tenantId,
      );
      if (!rows[0]) throw new AppError('Asset not found', ErrorCode.NOT_FOUND);

      const a = rows[0];
      const tip = await loadChainTip(tenantId, a.vault_id);
      if (!tip) {
        throw new AppError('No custody events for vault scope', ErrorCode.CONFLICT);
      }

      const subject: AssetReceiptSubject = {
        assetId: a.id,
        name: a.name,
        contentHash: a.content_hash,
        contentType: a.content_type ?? null,
        byteSize: a.byte_size != null ? Number(a.byte_size) : null,
        state: a.state,
        storageKey: a.storage_key,
        sealedAt: a.sealed_at ? new Date(a.sealed_at).toISOString() : null,
      };

      const receiptId = crypto.randomUUID();
      const issuedAt = new Date().toISOString();

      const body = {
        receiptId,
        kind: 'asset' as const,
        tenantId,
        issuedAt,
        subject,
        chainTip: {
          scopeId: a.vault_id,
          ...tip,
        },
        version: 1 as const,
      };

      const receiptHash = canonicalHash(body);
      const receipt: CustodyReceipt = { ...body, receiptHash };

      logger.info(
        { receiptId, assetId, contentHash: subject.contentHash, eventHash: tip.eventHash },
        'Asset custody receipt issued',
      );

      return receipt;
    },
    auditAction: 'data.read',
    auditResource: 'custody_receipt',
    auditResourceId: assetId,
    meterEventType: 'api_call',
  });
}

// ── issueVaultReceipt ────────────────────────────────────────

export async function issueVaultReceipt(
  tenantId: string,
  actorId: string,
  vaultId: string,
): Promise<CustodyReceipt> {
  return runCrudOperation({
    configName: 'custody-receipt',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const vaultRows = await withTenantQuery<any>(
        `SELECT * FROM custody_vaults WHERE id = $1 AND tenant_id = $2`,
        [vaultId, tenantId],
        tenantId,
      );
      if (!vaultRows[0]) throw new AppError('Vault not found', ErrorCode.NOT_FOUND);

      const countRows = await withTenantQuery<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM custody_assets
         WHERE tenant_id = $1 AND vault_id = $2`,
        [tenantId, vaultId],
        tenantId,
      );

      const tip = await loadChainTip(tenantId, vaultId);
      if (!tip) {
        throw new AppError('No custody events for vault scope', ErrorCode.CONFLICT);
      }

      const v = vaultRows[0];
      const subject: VaultReceiptSubject = {
        vaultId: v.id,
        name: v.name,
        state: v.state,
        ownerId: v.owner_id,
        sealedAt: v.sealed_at ? new Date(v.sealed_at).toISOString() : null,
        assetCount: Number(countRows[0]?.count ?? 0),
      };

      const receiptId = crypto.randomUUID();
      const issuedAt = new Date().toISOString();

      const body = {
        receiptId,
        kind: 'vault' as const,
        tenantId,
        issuedAt,
        subject,
        chainTip: {
          scopeId: vaultId,
          ...tip,
        },
        version: 1 as const,
      };

      const receiptHash = canonicalHash(body);
      const receipt: CustodyReceipt = { ...body, receiptHash };

      logger.info(
        { receiptId, vaultId, eventHash: tip.eventHash },
        'Vault custody receipt issued',
      );

      return receipt;
    },
    auditAction: 'data.read',
    auditResource: 'custody_receipt',
    auditResourceId: vaultId,
    meterEventType: 'api_call',
  });
}

// ── verifyReceipt ────────────────────────────────────────────

/**
 * Local verification of a receipt document.
 * - Recomputes receiptHash
 * - Optionally verifies the event chain for the scope (DB access)
 *
 * Does not decrypt assets. Does not prove legal ownership.
 */
export async function verifyReceipt(
  tenantId: string,
  receipt: CustodyReceipt,
  opts: { verifyChain?: boolean } = { verifyChain: true },
): Promise<{
  receiptHashValid: boolean;
  chainValid: boolean | null;
  chainBreakIndex?: number;
}> {
  const { receiptHash, ...body } = receipt;
  const receiptHashValid = canonicalHash(body) === receiptHash;

  if (!opts.verifyChain) {
    return { receiptHashValid, chainValid: null };
  }

  if (receipt.tenantId !== tenantId) {
    throw new AppError('Receipt tenant mismatch', ErrorCode.FORBIDDEN);
  }

  const rows = await withTenantQuery<any>(
    `SELECT scope_id, event_type, payload, previous_hash, event_hash
     FROM custody_events
     WHERE tenant_id = $1 AND scope_id = $2
     ORDER BY created_at ASC`,
    [tenantId, receipt.chainTip.scopeId],
    tenantId,
  );

  const events: ChainEvent[] = rows.map((r: any) => ({
    scopeId: r.scope_id,
    eventType: r.event_type,
    payload: typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload,
    previousHash: r.previous_hash,
    hash: r.event_hash,
  }));

  const brk = verifyChain(events);
  const chainValid = brk === null;

  // Tip must still match what the receipt claimed
  const tipMatches =
    events.length > 0 &&
    events[events.length - 1].hash === receipt.chainTip.eventHash;

  return {
    receiptHashValid,
    chainValid: chainValid && tipMatches,
    chainBreakIndex: brk?.index,
  };
}

// ── getAuthorizedAssetView ───────────────────────────────────

/**
 * Authorized metadata + storage pointer.
 * Does NOT decrypt. Does NOT return plaintext.
 * Caller is responsible for separate blob fetch + decrypt under policy.
 */
export async function getAuthorizedAssetView(
  tenantId: string,
  actorId: string,
  assetId: string,
): Promise<AuthorizedAssetView> {
  return runCrudOperation({
    configName: 'custody-receipt',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const rows = await withTenantQuery<any>(
        `SELECT a.*, v.state AS vault_state
         FROM custody_assets a
         JOIN custody_vaults v ON v.id = a.vault_id AND v.tenant_id = a.tenant_id
         WHERE a.id = $1 AND a.tenant_id = $2`,
        [assetId, tenantId],
        tenantId,
      );
      if (!rows[0]) throw new AppError('Asset not found', ErrorCode.NOT_FOUND);

      const a = rows[0];

      // Destroyed assets: metadata may remain for provenance, but storage is gone
      if (a.state === 'destroyed') {
        throw new AppError('Asset has been destroyed', ErrorCode.GONE as any);
      }

      return {
        assetId: a.id,
        vaultId: a.vault_id,
        name: a.name,
        contentType: a.content_type ?? null,
        byteSize: a.byte_size != null ? Number(a.byte_size) : null,
        contentHash: a.content_hash,
        state: a.state,
        storageKey: a.storage_key,
        encryptedEnvelope:
          typeof a.encrypted_envelope === 'string'
            ? JSON.parse(a.encrypted_envelope)
            : a.encrypted_envelope,
        createdAt: new Date(a.created_at).toISOString(),
        sealedAt: a.sealed_at ? new Date(a.sealed_at).toISOString() : null,
      } satisfies AuthorizedAssetView;
    },
    auditAction: 'data.read',
    auditResource: 'custody_asset',
    auditResourceId: assetId,
    meterEventType: 'api_call',
  });
}
