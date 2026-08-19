/**
 * platform/custody-ops
 *
 * Golden Key · high-level deposit / retrieve operations.
 *
 * depositSecure:
 *   plaintext → encryptForDeposit → putBlob → depositAsset
 *
 * retrieveSecure:
 *   getAsset → getBlob → decryptForRetrieve
 *   (only when asset state allows read — open or released)
 */

import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { encryptForDeposit, decryptForRetrieve } from '@platform/custody-crypto';
import { putBlob, getBlob } from '@platform/custody-storage';
import { depositAsset, getAsset } from '@platform/custody-vault';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('custody-ops');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
});

const READABLE = new Set(['open', 'released']);

export interface DepositSecureInput {
  vaultId: string;
  name: string;
  contentType?: string;
  plaintext: Buffer | Uint8Array | string;
}

export interface DepositSecureResult {
  assetId: string;
  vaultId: string;
  contentHash: string;
  storageKey: string;
  byteSize: number;
  state: string;
}

export interface RetrieveSecureResult {
  assetId: string;
  name: string;
  contentType: string | null;
  contentHash: string;
  plaintext: Buffer;
}

/**
 * Full secure deposit path.
 */
export async function depositSecure(
  tenantId: string,
  actorId: string,
  input: DepositSecureInput,
): Promise<DepositSecureResult> {
  return runCrudOperation({
    configName: 'custody-ops',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!input.vaultId) throw new AppError('vaultId is required', ErrorCode.BAD_REQUEST);
      if (!input.name) throw new AppError('name is required', ErrorCode.BAD_REQUEST);

      // 1. Encrypt
      const enc = await encryptForDeposit(tenantId, actorId, input.plaintext);

      // 2. Store ciphertext
      const stored = await putBlob(tenantId, actorId, enc.ciphertext, {
        contentType: 'application/octet-stream',
        name: input.name,
      });

      // 3. Register asset metadata in vault
      const deposited = await depositAsset(tenantId, actorId, {
        vaultId: input.vaultId,
        name: input.name,
        contentType: input.contentType,
        byteSize: stored.byteSize,
        contentHash: enc.contentHash,
        encryptedEnvelope: enc.envelope as unknown as Record<string, unknown>,
        storageKey: stored.storageKey,
      });

      logger.info(
        {
          assetId: deposited.asset.id,
          vaultId: input.vaultId,
          contentHash: enc.contentHash,
        },
        'Secure deposit complete',
      );

      return {
        assetId: deposited.asset.id,
        vaultId: input.vaultId,
        contentHash: enc.contentHash,
        storageKey: stored.storageKey,
        byteSize: stored.byteSize,
        state: deposited.asset.state,
      };
    },
    auditAction: 'data.created',
    auditResource: 'custody_ops_deposit',
    meterEventType: 'api_call',
  });
}

/**
 * Full secure retrieve path.
 * Allowed only when asset is open or released (not sealed/destroyed).
 */
export async function retrieveSecure(
  tenantId: string,
  actorId: string,
  assetId: string,
): Promise<RetrieveSecureResult> {
  return runCrudOperation({
    configName: 'custody-ops',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!assetId) throw new AppError('assetId is required', ErrorCode.BAD_REQUEST);

      const asset = await getAsset(tenantId, assetId);
      if (!asset) throw new AppError('Asset not found', ErrorCode.NOT_FOUND);

      if (!READABLE.has(asset.state)) {
        throw new AppError(
          `Cannot retrieve asset in state '${asset.state}' (must be open or released)`,
          ErrorCode.FORBIDDEN,
        );
      }

      if (!asset.storageKey) {
        throw new AppError('Asset has no storage key', ErrorCode.INTERNAL);
      }
      if (!asset.encryptedEnvelope) {
        throw new AppError('Asset has no encryption envelope', ErrorCode.INTERNAL);
      }

      // Fetch ciphertext
      const blob = await getBlob(tenantId, actorId, asset.storageKey);

      // Decrypt
      const dec = await decryptForRetrieve(
        tenantId,
        actorId,
        blob.bytes,
        asset.encryptedEnvelope as any,
      );

      // Defense in depth: envelope hash must match registered contentHash
      if (asset.contentHash && dec.contentHash !== asset.contentHash) {
        throw new AppError('Content hash mismatch vs asset record', ErrorCode.FORBIDDEN);
      }

      logger.info({ assetId, contentHash: dec.contentHash }, 'Secure retrieve complete');

      return {
        assetId: asset.id,
        name: asset.name,
        contentType: asset.contentType ?? null,
        contentHash: dec.contentHash,
        plaintext: dec.plaintext,
      };
    },
    auditAction: 'data.read',
    auditResource: 'custody_ops_retrieve',
    meterEventType: 'api_call',
  });
}
