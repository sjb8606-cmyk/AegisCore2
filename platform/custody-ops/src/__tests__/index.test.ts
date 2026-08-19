import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as crypto from 'crypto';

vi.mock('@platform/audit', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@platform/metering', () => ({
  recordUsage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@platform/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platform/utils')>();
  const devKey = crypto.createHash('sha256').update('aegis-custody-crypto-dev-master-v1').digest('hex');
  return {
    ...actual,
    loadConfig: vi.fn().mockImplementation((name: string) => {
      if (name === 'custody-crypto') {
        return { enabled: true, algorithm: 'aes-256-gcm', devMasterKeyHex: devKey };
      }
      if (name === 'custody-storage') {
        return {
          enabled: true,
          driver: 'memory',
          prefix: 'custody',
          region: 'us-east-1',
          limits: { maxBytes: 52_428_800 },
        };
      }
      return { enabled: true };
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

// In-memory stand-ins for vault tables
const assets = new Map<string, any>();

vi.mock('@platform/custody-vault', () => ({
  depositAsset: vi.fn(async (tenantId: string, actorId: string, input: any) => {
    const id = crypto.randomUUID();
    const asset = {
      id,
      tenantId,
      vaultId: input.vaultId,
      name: input.name,
      contentType: input.contentType ?? null,
      byteSize: input.byteSize,
      contentHash: input.contentHash,
      encryptedEnvelope: input.encryptedEnvelope,
      storageKey: input.storageKey,
      state: 'open',
    };
    assets.set(id, asset);
    return { asset, event: { eventType: 'asset.deposited' } };
  }),
  getAsset: vi.fn(async (tenantId: string, assetId: string) => {
    const a = assets.get(assetId);
    if (!a || a.tenantId !== tenantId) return null;
    return a;
  }),
}));

// Real crypto + storage (memory driver)
import { __resetMemoryStore, __resetDriverCache } from '@platform/custody-storage';
import { depositSecure, retrieveSecure } from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';
const vaultId = '00000000-0000-4000-8000-0000000000v1';

describe('custody-ops', () => {
  beforeEach(() => {
    assets.clear();
    __resetMemoryStore();
    __resetDriverCache();
    vi.clearAllMocks();
  });

  it('depositSecure then retrieveSecure round-trips plaintext', async () => {
    const plain = Buffer.from('my invention notes — do not leak');
    const dep = await depositSecure(tenantId, actorId, {
      vaultId,
      name: 'invention.txt',
      contentType: 'text/plain',
      plaintext: plain,
    });

    expect(dep.assetId).toBeTruthy();
    expect(dep.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(dep.storageKey).toContain(tenantId);
    expect(dep.state).toBe('open');

    const got = await retrieveSecure(tenantId, actorId, dep.assetId);
    expect(got.plaintext.equals(plain)).toBe(true);
    expect(got.contentHash).toBe(dep.contentHash);
    expect(got.name).toBe('invention.txt');
  });

  it('retrieveSecure rejects sealed assets', async () => {
    const dep = await depositSecure(tenantId, actorId, {
      vaultId,
      name: 'sealed.bin',
      plaintext: Buffer.from('x'),
    });
    const a = assets.get(dep.assetId);
    a.state = 'sealed';

    try {
      await retrieveSecure(tenantId, actorId, dep.assetId);
      expect.fail('should throw');
    } catch (err: any) {
      expect(String(err?.message ?? err)).toMatch(/sealed|state/i);
    }
  });

  it('retrieveSecure rejects missing assets', async () => {
    try {
      await retrieveSecure(tenantId, actorId, '00000000-0000-4000-8000-000000000099');
      expect.fail('should throw');
    } catch (err: any) {
      expect(String(err?.message ?? err)).toMatch(/not found/i);
    }
  });
});
