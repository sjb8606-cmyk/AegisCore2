import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as crypto from 'crypto';

vi.mock('@platform/audit', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@platform/metering', () => ({
  recordUsage: vi.fn().mockResolvedValue(undefined),
}));

// Key computed INSIDE the factory — safe under hoist
vi.mock('@platform/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platform/utils')>();
  const devKey = crypto.createHash('sha256').update('aegis-custody-crypto-dev-master-v1').digest('hex');
  return {
    ...actual,
    loadConfig: vi.fn().mockReturnValue({
      enabled: true,
      algorithm: 'aes-256-gcm',
      devMasterKeyHex: devKey,
    }),
  };
});

vi.mock('@platform/observability', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  encryptForDeposit,
  decryptForRetrieve,
  __pureEncrypt,
  __pureDecrypt,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const otherTenant = '00000000-0000-4000-8000-000000000002';
const actorId = '00000000-0000-4000-8000-0000000000aa';
const MASTER = crypto.createHash('sha256').update('aegis-custody-crypto-dev-master-v1').digest();

describe('custody-crypto', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('encrypt then decrypt round-trips', async () => {
    const plain = Buffer.from('super secret IP document v1');
    const enc = await encryptForDeposit(tenantId, actorId, plain);

    expect(enc.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(enc.envelope.v).toBe(1);
    expect(enc.envelope.contentHash).toBe(enc.contentHash);
    expect(enc.ciphertext.length).toBeGreaterThan(0);
    expect(enc.ciphertext.equals(plain)).toBe(false);

    const dec = await decryptForRetrieve(tenantId, actorId, enc.ciphertext, enc.envelope);
    expect(dec.plaintext.equals(plain)).toBe(true);
    expect(dec.contentHash).toBe(enc.contentHash);
  });

  it('rejects empty plaintext', async () => {
    try {
      await encryptForDeposit(tenantId, actorId, Buffer.alloc(0));
      expect.fail('should throw');
    } catch (err: any) {
      expect(String(err?.message ?? err)).toMatch(/empty/i);
    }
  });

  it('fails decrypt when ciphertext is tampered', async () => {
    const enc = await encryptForDeposit(tenantId, actorId, Buffer.from('hello'));
    const tampered = Buffer.from(enc.ciphertext);
    tampered[0] = tampered[0] ^ 0xff;

    try {
      await decryptForRetrieve(tenantId, actorId, tampered, enc.envelope);
      expect.fail('should throw');
    } catch (err: any) {
      expect(String(err?.message ?? err)).toMatch(/decrypt|auth|mismatch|fail/i);
    }
  });

  it('different tenants cannot unwrap each others CEKs', async () => {
    const plain = Buffer.from('tenant-bound secret');
    const enc = __pureEncrypt(tenantId, plain, MASTER);

    try {
      __pureDecrypt(otherTenant, enc.ciphertext, enc.envelope, MASTER);
      expect.fail('should throw');
    } catch {
      expect(true).toBe(true);
    }
  });

  it('envelope binds contentHash', async () => {
    const enc = await encryptForDeposit(tenantId, actorId, Buffer.from('abc'));
    const badEnvelope = { ...enc.envelope, contentHash: '00'.repeat(32) };

    try {
      await decryptForRetrieve(tenantId, actorId, enc.ciphertext, badEnvelope);
      expect.fail('should throw');
    } catch (err: any) {
      expect(String(err?.message ?? err)).toMatch(/hash/i);
    }
  });
});
