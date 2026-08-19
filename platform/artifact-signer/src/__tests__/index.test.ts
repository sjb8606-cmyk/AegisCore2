/**
 * artifact-signer tests
 * No outer consts referenced by vi.mock factories (Vitest hoists mocks).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as crypto from 'crypto';

vi.mock('@platform/tenancy', () => ({
  withTenantQuery: vi.fn(),
  getPool: vi.fn(),
}));

vi.mock('@platform/audit', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@platform/metering', () => ({
  recordUsage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@platform/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platform/utils')>();
  return {
    ...actual,
    loadConfig: vi.fn().mockReturnValue({
      enabled: true,
      vaultKeyPath: 'crucible/artifact-signer',
      limits: { signsPerMonth: 10000 },
    }),
  };
});

vi.mock('@platform/bot-runtime', () => ({
  saveDecision: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@platform/observability', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Key material created INSIDE the factory — safe under hoist
vi.mock('@platform/security', () => {
  const pair = crypto.generateKeyPairSync('ed25519');
  const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('hex');
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
  return {
    getSecret: vi.fn().mockResolvedValue({ privateKey, publicKey }),
  };
});

import { signArtifact, verifySignature, generateKeyPairHex, formatDetachedSig } from '../index';
import { saveDecision } from '@platform/bot-runtime';
import { emit as auditEmit } from '@platform/audit';
import { getSecret } from '@platform/security';

describe('verifySignature (standalone)', () => {
  it('returns true for a valid signature over a content hash', () => {
    const pair = crypto.generateKeyPairSync('ed25519');
    const publicKeyHex = pair.publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
    const contentHash = crypto.createHash('sha256').update('hello-sbom').digest('hex');
    const sig = crypto.sign(null, Buffer.from(contentHash, 'hex'), pair.privateKey);

    expect(
      verifySignature({
        contentHash,
        signature: sig.toString('hex'),
        publicKey: publicKeyHex,
      }),
    ).toBe(true);
  });

  it('returns false when the hash does not match', () => {
    const pair = crypto.generateKeyPairSync('ed25519');
    const publicKeyHex = pair.publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
    const realHash = crypto.createHash('sha256').update('hello-sbom').digest('hex');
    const wrongHash = crypto.createHash('sha256').update('tampered').digest('hex');
    const sig = crypto.sign(null, Buffer.from(realHash, 'hex'), pair.privateKey);

    expect(
      verifySignature({
        contentHash: wrongHash,
        signature: sig.toString('hex'),
        publicKey: publicKeyHex,
      }),
    ).toBe(false);
  });

  it('returns false for garbage input instead of throwing', () => {
    expect(
      verifySignature({
        contentHash: 'not-a-hash',
        signature: 'deadbeef',
        publicKey: '00',
      }),
    ).toBe(false);
  });
});

describe('generateKeyPairHex', () => {
  it('returns hex material that can sign/verify', () => {
    const pair = generateKeyPairHex();
    expect(pair.privateKey).toMatch(/^[0-9a-f]+$/i);
    expect(pair.publicKey).toMatch(/^[0-9a-f]+$/i);

    const privateKey = crypto.createPrivateKey({
      key: Buffer.from(pair.privateKey, 'hex'),
      format: 'der',
      type: 'pkcs8',
    });
    const publicKey = crypto.createPublicKey({
      key: Buffer.from(pair.publicKey, 'hex'),
      format: 'der',
      type: 'spki',
    });

    const hash = crypto.createHash('sha256').update('test').digest();
    const sig = crypto.sign(null, hash, privateKey);
    expect(crypto.verify(null, hash, publicKey, sig)).toBe(true);
  });
});

describe('signArtifact', () => {
  const tenantId = '00000000-0000-4000-8000-000000000001';
  const actorId = 'service:supply-chain-cartographer';

  beforeEach(() => {
    vi.clearAllMocks();
    // restore getSecret implementation after clearAllMocks
    const pair = crypto.generateKeyPairSync('ed25519');
    (getSecret as any).mockResolvedValue({
      privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('hex'),
      publicKey: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('hex'),
    });
  });

  it('signs a content hash and produces a verifiable signature', async () => {
    const raw = Buffer.from('{"sbom":"example"}');
    const result = await signArtifact(tenantId, actorId, raw);

    expect(result.algorithm).toBe('ed25519');
    expect(result.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.signature).toMatch(/^[0-9a-f]+$/i);
    expect(result.decisionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    expect(
      verifySignature({
        contentHash: result.contentHash,
        signature: result.signature,
        publicKey: result.publicKey,
      }),
    ).toBe(true);
  });

  it('accepts a pre-computed hash when contentIsHash=true', async () => {
    const hash = crypto.createHash('sha256').update('already-hashed').digest('hex');
    const result = await signArtifact(tenantId, actorId, hash, { contentIsHash: true });

    expect(result.contentHash).toBe(hash);
    expect(
      verifySignature({
        contentHash: result.contentHash,
        signature: result.signature,
        publicKey: result.publicKey,
      }),
    ).toBe(true);
  });

  it('records a decision via saveDecision', async () => {
    await signArtifact(tenantId, actorId, Buffer.from('x'));
    expect(saveDecision).toHaveBeenCalledTimes(1);
    const arg = (saveDecision as any).mock.calls[0][0];
    expect(arg.botId).toBe('artifact-signer');
    expect(arg.status).toBe('approved');
    expect(arg.input.algorithm).toBe('ed25519');
  });

  it('emits a real audit action (bot.decision_recorded)', async () => {
    await signArtifact(tenantId, actorId, Buffer.from('y'));
    expect(auditEmit).toHaveBeenCalled();
    const arg = (auditEmit as any).mock.calls[0][0];
    expect(arg.action).toBe('bot.decision_recorded');
  });

  it('formatDetachedSig produces a readable sidecar', async () => {
    const result = await signArtifact(tenantId, actorId, Buffer.from('z'));
    const sidecar = formatDetachedSig(result);
    expect(sidecar).toContain('-----BEGIN ARTIFACT SIGNATURE-----');
    expect(sidecar).toContain(result.signature);
    expect(sidecar).toContain(result.contentHash);
  });
});
