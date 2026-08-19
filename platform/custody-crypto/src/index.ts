/**
 * platform/custody-crypto
 *
 * Golden Key · classical encrypt/decrypt helpers for custody blobs.
 *
 * Model:
 *   - Content-encryption key (CEK) is random 256-bit per asset
 *   - CEK encrypts plaintext with AES-256-GCM
 *   - CEK is encrypted (wrapped) with a tenant data key
 *   - Envelope JSON is what custody-vault stores in encrypted_envelope
 *   - Ciphertext bytes go to custody-storage
 *
 * This core does NOT talk to object storage or the vault tables.
 * Callers wire: encrypt → putBlob → depositAsset metadata.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('custody-crypto');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  /** Hex-encoded 32-byte master key for local/dev wrapping (NOT for production) */
  devMasterKeyHex: z.string().optional(),
  algorithm: z.literal('aes-256-gcm').default('aes-256-gcm'),
});

export type CustodyCryptoConfig = z.infer<typeof ConfigSchema>;

/** Stored alongside the asset row — never contains plaintext */
export interface CustodyEnvelope {
  v: 1;
  alg: 'aes-256-gcm';
  /** IV for content encryption (base64) */
  iv: string;
  /** Auth tag for content encryption (base64) */
  tag: string;
  /** Wrapped CEK (base64) */
  wrappedCek: string;
  /** IV used when wrapping CEK (base64) */
  wrapIv: string;
  /** Auth tag for CEK wrap (base64) */
  wrapTag: string;
  /** sha256 of plaintext (hex) — integrity / receipt binding */
  contentHash: string;
  /** ciphertext byte length */
  ciphertextBytes: number;
}

export interface EncryptResult {
  ciphertext: Buffer;
  envelope: CustodyEnvelope;
  contentHash: string;
}

export interface DecryptResult {
  plaintext: Buffer;
  contentHash: string;
}

// ── Key material ─────────────────────────────────────────────

function sha256Hex(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function getDevMasterKey(config: CustodyCryptoConfig): Buffer {
  if (config.devMasterKeyHex) {
    const buf = Buffer.from(config.devMasterKeyHex, 'hex');
    if (buf.length !== 32) {
      throw new AppError('devMasterKeyHex must be 32 bytes (64 hex chars)', ErrorCode.INTERNAL);
    }
    return buf;
  }
  // Deterministic dev fallback — tests only. Production must set a real key/KMS.
  return crypto.createHash('sha256').update('aegis-custody-crypto-dev-master-v1').digest();
}

/**
 * Derive a per-tenant wrapping key from the master key.
 * Production path should replace this with KMS Encrypt/Decrypt of the CEK.
 */
function tenantWrapKey(master: Buffer, tenantId: string): Buffer {
  return crypto.createHmac('sha256', master).update('tenant-wrap:' + tenantId).digest();
}

function aesGcmEncrypt(key: Buffer, plaintext: Buffer): { iv: Buffer; tag: Buffer; ciphertext: Buffer } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv, tag, ciphertext };
}

function aesGcmDecrypt(key: Buffer, iv: Buffer, tag: Buffer, ciphertext: Buffer): Buffer {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// ── Public API ───────────────────────────────────────────────

/**
 * Encrypt plaintext for deposit.
 * Returns ciphertext bytes + envelope to store with the asset.
 */
export async function encryptForDeposit(
  tenantId: string,
  actorId: string,
  plaintext: Buffer | Uint8Array | string,
): Promise<EncryptResult> {
  const plain = Buffer.isBuffer(plaintext)
    ? plaintext
    : typeof plaintext === 'string'
      ? Buffer.from(plaintext, 'utf8')
      : Buffer.from(plaintext);

  return runCrudOperation({
    configName: 'custody-crypto',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    actorType: 'service',
    action: async () => {
      if (plain.length === 0) {
        throw new AppError('Cannot encrypt empty plaintext', ErrorCode.BAD_REQUEST);
      }

      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('custody-crypto', ConfigSchema);
      const master = getDevMasterKey(config);
      const wrapKey = tenantWrapKey(master, tenantId);

      const contentHash = sha256Hex(plain);
      const cek = crypto.randomBytes(32);

      // Encrypt content
      const content = aesGcmEncrypt(cek, plain);

      // Wrap CEK
      const wrapped = aesGcmEncrypt(wrapKey, cek);

      const envelope: CustodyEnvelope = {
        v: 1,
        alg: 'aes-256-gcm',
        iv: content.iv.toString('base64'),
        tag: content.tag.toString('base64'),
        wrappedCek: wrapped.ciphertext.toString('base64'),
        wrapIv: wrapped.iv.toString('base64'),
        wrapTag: wrapped.tag.toString('base64'),
        contentHash,
        ciphertextBytes: content.ciphertext.length,
      };

      logger.info(
        { tenantId, contentHash, ciphertextBytes: content.ciphertext.length },
        'Encrypted for deposit',
      );

      return {
        ciphertext: content.ciphertext,
        envelope,
        contentHash,
      };
    },
    auditAction: 'data.created',
    auditResource: 'custody_crypto',
    meterEventType: 'api_call',
  });
}

/**
 * Decrypt ciphertext for authorized retrieve.
 * Verifies contentHash in the envelope matches plaintext.
 */
export async function decryptForRetrieve(
  tenantId: string,
  actorId: string,
  ciphertext: Buffer | Uint8Array,
  envelope: CustodyEnvelope,
): Promise<DecryptResult> {
  const ct = Buffer.isBuffer(ciphertext) ? ciphertext : Buffer.from(ciphertext);

  return runCrudOperation({
    configName: 'custody-crypto',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    actorType: 'service',
    action: async () => {
      if (!envelope || envelope.v !== 1 || envelope.alg !== 'aes-256-gcm') {
        throw new AppError('Unsupported or missing envelope', ErrorCode.BAD_REQUEST);
      }
      if (ct.length === 0) {
        throw new AppError('Ciphertext is empty', ErrorCode.BAD_REQUEST);
      }

      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('custody-crypto', ConfigSchema);
      const master = getDevMasterKey(config);
      const wrapKey = tenantWrapKey(master, tenantId);

      // Unwrap CEK
      let cek: Buffer;
      try {
        cek = aesGcmDecrypt(
          wrapKey,
          Buffer.from(envelope.wrapIv, 'base64'),
          Buffer.from(envelope.wrapTag, 'base64'),
          Buffer.from(envelope.wrappedCek, 'base64'),
        );
      } catch {
        throw new AppError('Failed to unwrap content key', ErrorCode.FORBIDDEN);
      }

      // Decrypt content
      let plain: Buffer;
      try {
        plain = aesGcmDecrypt(
          cek,
          Buffer.from(envelope.iv, 'base64'),
          Buffer.from(envelope.tag, 'base64'),
          ct,
        );
      } catch {
        throw new AppError('Decryption failed (auth tag mismatch or corrupt data)', ErrorCode.FORBIDDEN);
      }

      const contentHash = sha256Hex(plain);
      if (contentHash !== envelope.contentHash) {
        throw new AppError('Content hash mismatch after decrypt', ErrorCode.FORBIDDEN);
      }

      logger.info({ tenantId, contentHash }, 'Decrypted for retrieve');
      return { plaintext: plain, contentHash };
    },
    auditAction: 'data.read',
    auditResource: 'custody_crypto',
    meterEventType: 'api_call',
  });
}

/**
 * Pure helpers (no CRUD / audit) for unit tests and offline verify.
 */
export function __pureEncrypt(
  tenantId: string,
  plaintext: Buffer,
  masterKey: Buffer,
): EncryptResult {
  const wrapKey = tenantWrapKey(masterKey, tenantId);
  const contentHash = sha256Hex(plaintext);
  const cek = crypto.randomBytes(32);
  const content = aesGcmEncrypt(cek, plaintext);
  const wrapped = aesGcmEncrypt(wrapKey, cek);
  return {
    ciphertext: content.ciphertext,
    contentHash,
    envelope: {
      v: 1,
      alg: 'aes-256-gcm',
      iv: content.iv.toString('base64'),
      tag: content.tag.toString('base64'),
      wrappedCek: wrapped.ciphertext.toString('base64'),
      wrapIv: wrapped.iv.toString('base64'),
      wrapTag: wrapped.tag.toString('base64'),
      contentHash,
      ciphertextBytes: content.ciphertext.length,
    },
  };
}

export function __pureDecrypt(
  tenantId: string,
  ciphertext: Buffer,
  envelope: CustodyEnvelope,
  masterKey: Buffer,
): Buffer {
  const wrapKey = tenantWrapKey(masterKey, tenantId);
  const cek = aesGcmDecrypt(
    wrapKey,
    Buffer.from(envelope.wrapIv, 'base64'),
    Buffer.from(envelope.wrapTag, 'base64'),
    Buffer.from(envelope.wrappedCek, 'base64'),
  );
  return aesGcmDecrypt(
    cek,
    Buffer.from(envelope.iv, 'base64'),
    Buffer.from(envelope.tag, 'base64'),
    ciphertext,
  );
}
