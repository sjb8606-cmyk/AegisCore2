/**
 * platform/artifact-signer
 *
 * D-23 · Artifact Signer
 * Closes gate: SBOM-02
 *
 * Signs content *hashes* (not raw content) with Ed25519.
 * Produces a detached .sig sidecar. Verification is standalone
 * and does not require AegisCore infrastructure.
 *
 * Key material is loaded from HashiCorp Vault via the existing
 * platform/security vault client. No second key-storage path.
 * No PQC. No hardware vault. Classical only.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getSecret } from '@platform/security';
import { saveDecision } from '@platform/bot-runtime';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('artifact-signer');

// ── Config ───────────────────────────────────────────────────

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  /** Vault path that holds the Ed25519 key pair (privateKey + publicKey fields) */
  vaultKeyPath: z.string().default('crucible/artifact-signer'),
  limits: z.object({
    signsPerMonth: z.number().int().positive().default(10_000),
  }).default({}),
});

export type ArtifactSignerConfig = z.infer<typeof ConfigSchema>;

// ── Types ────────────────────────────────────────────────────

export interface SignResult {
  /** Hex-encoded Ed25519 signature */
  signature: string;
  /** Algorithm identifier */
  algorithm: 'ed25519';
  /** Hex public key that can verify this signature */
  publicKey: string;
  /** The exact hash that was signed (SHA-256 hex) */
  contentHash: string;
  /** ISO timestamp of signing */
  signedAt: string;
  /** Decision id recorded for this signing act */
  decisionId: string;
}

export interface VerifyInput {
  /** Original content hash (SHA-256 hex) that was signed */
  contentHash: string;
  /** Hex-encoded signature */
  signature: string;
  /** Hex-encoded public key */
  publicKey: string;
}

// ── Pure verification (NO AegisCore dependency) ──────────────
// This function is deliberately free of platform imports so an
// external auditor can copy it and verify without trusting us.

export function verifySignature(input: VerifyInput): boolean {
  try {
    const publicKey = crypto.createPublicKey({
      key: Buffer.from(input.publicKey, 'hex'),
      format: 'der',
      type: 'spki',
    });

    return crypto.verify(
      null, // Ed25519 ignores the algorithm parameter
      Buffer.from(input.contentHash, 'hex'),
      publicKey,
      Buffer.from(input.signature, 'hex'),
    );
  } catch {
    return false;
  }
}

// ── Internal helpers ─────────────────────────────────────────

function sha256Hex(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Load Ed25519 key pair from Vault.
 * Expected secret shape at vaultKeyPath:
 *   { privateKey: <hex pkcs8>, publicKey: <hex spki> }
 */
async function loadKeyPair(vaultKeyPath: string): Promise<{
  privateKey: crypto.KeyObject;
  publicKeyHex: string;
}> {
  const secret = await getSecret(vaultKeyPath);

  if (!secret.privateKey || !secret.publicKey) {
    throw new AppError(
      `Vault secret at '${vaultKeyPath}' missing privateKey or publicKey fields`,
      ErrorCode.INTERNAL,
    );
  }

  const privateKey = crypto.createPrivateKey({
    key: Buffer.from(secret.privateKey, 'hex'),
    format: 'der',
    type: 'pkcs8',
  });

  return {
    privateKey,
    publicKeyHex: secret.publicKey,
  };
}

/**
 * Generate a fresh Ed25519 key pair and return hex-encoded
 * PKCS8 private + SPKI public. Intended for one-time bootstrap
 * (key generation is a Synchronous Gate — human approval required
 * before the private key is written into Vault).
 */
export function generateKeyPairHex(): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');

  return {
    privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('hex'),
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('hex'),
  };
}

// ── Main signing operation ───────────────────────────────────

/**
 * Sign the SHA-256 hash of an artifact.
 *
 * @param tenantId  - tenant context (for audit / decision)
 * @param actorId   - who/what is requesting the signature
 * @param content   - raw content OR pre-computed hash
 * @param opts      - if contentIsHash=true, `content` is treated as already-hashed hex
 */
export async function signArtifact(
  tenantId: string,
  actorId: string,
  content: Buffer | string,
  opts: { contentIsHash?: boolean; botId?: string } = {},
): Promise<SignResult> {
  return runCrudOperation({
    configName: 'artifact-signer',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    actorType: 'service',
    // Quota is intentionally light for signing; heavy abuse is more
    // of a key-compromise concern than a row-count concern.
    checkQuota: async () => {
      // Placeholder: real monthly quota can be added later via quota-guard
      // once a signs ledger table exists. For v1 we rely on Vault access
      // controls and audit volume monitoring.
    },
    action: async () => {
      const config = ConfigSchema.parse(
        // loadConfig is already called inside runCrudOperation;
        // we re-parse only what we need for the vault path.
        // In practice the config object is available via the closure
        // if we lift it, but we keep the call explicit and safe.
        (await import('@platform/utils')).loadConfig('artifact-signer', ConfigSchema),
      );

      const contentHash = opts.contentIsHash
        ? String(content)
        : sha256Hex(typeof content === 'string' ? Buffer.from(content) : content);

      if (!/^[0-9a-f]{64}$/i.test(contentHash)) {
        throw new AppError('contentHash must be a 64-char hex SHA-256', ErrorCode.BAD_REQUEST);
      }

      const { privateKey, publicKeyHex } = await loadKeyPair(config.vaultKeyPath);

      const signature = crypto.sign(null, Buffer.from(contentHash, 'hex'), privateKey);
      const signatureHex = signature.toString('hex');
      const signedAt = new Date().toISOString();
      const decisionId = crypto.randomUUID();

      // Record the act of signing itself as a bot decision
      // (spec requirement: every signing operation is receipted).
      await saveDecision({
        id: decisionId,
        botId: opts.botId ?? 'artifact-signer',
        status: 'approved', // mechanical signing is not HITL-gated
        input: {
          contentHash,
          algorithm: 'ed25519',
        },
        output: {
          signature: signatureHex,
          publicKey: publicKeyHex,
          signedAt,
        },
        rulesHash: sha256Hex('artifact-signer:ed25519:v1'),
        timestamp: signedAt,
      });

      logger.info(
        { contentHash, decisionId, algorithm: 'ed25519' },
        'Artifact signed',
      );

      return {
        signature: signatureHex,
        algorithm: 'ed25519' as const,
        publicKey: publicKeyHex,
        contentHash,
        signedAt,
        decisionId,
      };
    },
    // Must be a real value from platform/audit AuditAction enum
    auditAction: 'bot.decision_recorded',
    auditResource: 'artifact_signature',
    auditMetadata: {
      algorithm: 'ed25519',
    },
    meterEventType: 'api_call',
  });
}

/**
 * Convenience: produce the detached .sig sidecar bytes
 * (UTF-8 text containing the hex signature + metadata).
 */
export function formatDetachedSig(result: SignResult): string {
  return [
    '-----BEGIN ARTIFACT SIGNATURE-----',
    `algorithm: ${result.algorithm}`,
    `content-hash: ${result.contentHash}`,
    `public-key: ${result.publicKey}`,
    `signed-at: ${result.signedAt}`,
    `decision-id: ${result.decisionId}`,
    result.signature,
    '-----END ARTIFACT SIGNATURE-----',
  ].join('\n');
}
