/**
 * platform/security/src/kms.ts
 *
 * AWS KMS envelope encryption.
 *
 * Pattern:
 *   1. Generate a random data key (DEK) via KMS GenerateDataKey
 *   2. Encrypt plaintext locally with DEK (AES-256-GCM)
 *   3. Store the encrypted DEK alongside the ciphertext
 *   4. On decrypt: call KMS to decrypt DEK, then decrypt locally
 *
 * This minimises KMS API calls (only 1 per encrypt/decrypt operation)
 * while keeping the actual data encrypted locally with a unique DEK.
 */

import {
  KMSClient,
  GenerateDataKeyCommand,
  DecryptCommand,
} from '@aws-sdk/client-kms';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { getLogger } from '@platform/observability';

const logger = getLogger('security:kms');

// ── Client ────────────────────────────────────────────────────

let _kms: KMSClient | null = null;

function getKmsClient(): KMSClient {
  if (!_kms) {
    _kms = new KMSClient({
      region: process.env.AWS_REGION || 'us-east-1',
      ...(process.env.AWS_ENDPOINT_URL ? { endpoint: process.env.AWS_ENDPOINT_URL } : {}),
      ...(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
        ? {
            credentials: {
              accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
              secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            },
          }
        : {}),
    });
  }
  return _kms;
}

const KEY_ID    = process.env.KMS_KEY_ID  || '';
const ALGORITHM = 'aes-256-gcm' as const;

// ── Envelope types ────────────────────────────────────────────

export interface EncryptedEnvelope {
  /** Base64-encoded ciphertext */
  ciphertext:    string;
  /** Base64-encoded encrypted DEK (from KMS) */
  encryptedDek:  string;
  /** Base64-encoded AES-GCM IV */
  iv:            string;
  /** Base64-encoded authentication tag */
  authTag:       string;
  /** KMS key alias/ID used */
  keyId:         string;
  /** Algorithm identifier */
  algorithm:     typeof ALGORITHM;
}

// ── Encrypt ───────────────────────────────────────────────────

/**
 * encrypt — envelope-encrypt a plaintext string.
 * Returns an EncryptedEnvelope with all fields needed to decrypt.
 */
export async function encrypt(plaintext: string): Promise<EncryptedEnvelope> {
  if (!KEY_ID) throw new Error('KMS_KEY_ID is not configured');

  const kms = getKmsClient();

  // 1. Generate data key
  const { Plaintext: dek, CiphertextBlob: encryptedDek } = await kms.send(
    new GenerateDataKeyCommand({ KeyId: KEY_ID, KeySpec: 'AES_256' })
  );

  if (!dek || !encryptedDek) {
    throw new Error('KMS GenerateDataKey returned empty key material');
  }

  // 2. Encrypt locally with AES-256-GCM
  const iv     = randomBytes(12); // 96-bit IV for GCM
  const cipher = createCipheriv(ALGORITHM, Buffer.from(dek), iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // 3. Securely zero out the plaintext DEK from memory
  Buffer.from(dek).fill(0);

  logger.debug({ keyId: KEY_ID }, 'Envelope encrypted');

  return {
    ciphertext:   encrypted.toString('base64'),
    encryptedDek: Buffer.from(encryptedDek).toString('base64'),
    iv:           iv.toString('base64'),
    authTag:      authTag.toString('base64'),
    keyId:        KEY_ID,
    algorithm:    ALGORITHM,
  };
}

// ── Decrypt ───────────────────────────────────────────────────

/**
 * decrypt — decrypt an EncryptedEnvelope.
 */
export async function decrypt(envelope: EncryptedEnvelope): Promise<string> {
  const kms = getKmsClient();

  // 1. Decrypt the DEK via KMS
  const { Plaintext: dek } = await kms.send(
    new DecryptCommand({
      CiphertextBlob: Buffer.from(envelope.encryptedDek, 'base64'),
      KeyId:          envelope.keyId,
    })
  );

  if (!dek) throw new Error('KMS Decrypt returned empty plaintext DEK');

  // 2. Decrypt ciphertext locally
  const decipher = createDecipheriv(
    ALGORITHM,
    Buffer.from(dek),
    Buffer.from(envelope.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');

  // Zero out DEK from memory
  Buffer.from(dek).fill(0);

  logger.debug({ keyId: envelope.keyId }, 'Envelope decrypted');
  return plaintext;
}

// ── Field-level encryption helpers ────────────────────────────

/**
 * encryptField — convenience wrapper for encrypting a single field value.
 */
export async function encryptField(value: string): Promise<string> {
  const envelope = await encrypt(value);
  return JSON.stringify(envelope);
}

/**
 * decryptField — convenience wrapper for decrypting a field.
 */
export async function decryptField(encoded: string): Promise<string> {
  const envelope: EncryptedEnvelope = JSON.parse(encoded);
  return decrypt(envelope);
}
