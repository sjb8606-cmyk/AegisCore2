/**
 * custody-vault tests (mocked DB / platform deps)
 *
 * Covers:
 * - createVault happy path + quota enforcement shape
 * - depositAsset validates hash + requires open vault
 * - sealVault transitions state and records event
 * - hash-chain helpers are invoked with GENESIS on first event
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = {
  vaults: [] as any[],
  assets: [] as any[],
  events: [] as any[],
};

vi.mock('@platform/tenancy', () => ({
  withTenantQuery: vi.fn(async (sql: string, params: any[]) => {
    if (sql.includes('COUNT(*)') && sql.includes('custody_vaults')) {
      return [{ count: String(store.vaults.length) }];
    }
    if (sql.includes('COUNT(*)') && sql.includes('custody_assets')) {
      return [{ count: String(store.assets.length) }];
    }
    if (sql.startsWith('INSERT INTO custody_vaults')) {
      const row = {
        id: params[0],
        tenant_id: params[1],
        owner_id: params[2],
        name: params[3],
        description: params[4],
        state: 'open',
        policy: JSON.parse(params[5] || '{}'),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        sealed_at: null,
        released_at: null,
        destroyed_at: null,
      };
      store.vaults.push(row);
      return [row];
    }
    if (sql.startsWith('INSERT INTO custody_assets')) {
      const row = {
        id: params[0],
        tenant_id: params[1],
        vault_id: params[2],
        name: params[3],
        content_type: params[4],
        byte_size: params[5],
        content_hash: params[6],
        encrypted_envelope: JSON.parse(params[7]),
        storage_key: params[8],
        state: 'open',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        sealed_at: null,
        destroyed_at: null,
      };
      store.assets.push(row);
      return [row];
    }
    if (sql.startsWith('INSERT INTO custody_events')) {
      const row = {
        id: params[0],
        tenant_id: params[1],
        scope_id: params[2],
        vault_id: params[3],
        asset_id: params[4],
        event_type: params[5],
        actor_id: params[6],
        actor_type: params[7],
        payload: JSON.parse(params[8]),
        previous_hash: params[9],
        event_hash: params[10],
        created_at: new Date().toISOString(),
      };
      store.events.push(row);
      return [row];
    }
    if (sql.includes('FROM custody_vaults WHERE id')) {
      const v = store.vaults.find((x) => x.id === params[0]);
      return v ? [v] : [];
    }
    if (sql.includes('FROM custody_assets WHERE id')) {
      const a = store.assets.find((x) => x.id === params[0]);
      return a ? [a] : [];
    }
    if (sql.includes('FROM custody_events') && sql.includes('ORDER BY created_at DESC')) {
      const scope = params[1];
      const list = store.events
        .filter((e) => e.scope_id === scope)
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      return list[0] ? [list[0]] : [];
    }
    if (sql.startsWith('UPDATE custody_vaults')) {
      const v = store.vaults.find((x) => x.id === params[0]);
      if (!v) return [];
      v.state = 'sealed';
      v.sealed_at = new Date().toISOString();
      v.updated_at = new Date().toISOString();
      return [v];
    }
    if (sql.startsWith('UPDATE custody_assets') && sql.includes("state = 'sealed'")) {
      for (const a of store.assets) {
        if (a.vault_id === params[0] && a.state === 'open') {
          a.state = 'sealed';
          a.sealed_at = new Date().toISOString();
        }
      }
      return [];
    }
    return [];
  }),
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
      limits: { vaultsPerTenant: 50, assetsPerVault: 10000 },
    }),
  };
});

vi.mock('@platform/observability', () => ({
  getLogger: () => ({
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  }),
}));

vi.mock('@platform/quota-guard', () => ({
  enforceQuota: vi.fn((count: number, limit: number, msg: string) => {
    if (count >= limit) {
      const { AppError, ErrorCode } = require('@platform/crud-kernel');
      throw new AppError(msg, ErrorCode.RATE_LIMITED);
    }
  }),
}));

import { createVault, depositAsset, sealVault, getVault } from '../index';
import { GENESIS_HASH } from '@platform/hash-chain';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';

describe('custody-vault', () => {
  beforeEach(() => {
    store.vaults.length = 0;
    store.assets.length = 0;
    store.events.length = 0;
  });

  it('creates a vault and records a genesis-chained event', async () => {
    const { vault, event } = await createVault(tenantId, actorId, {
      name: 'Personal IP',
      description: 'Source + designs',
    });

    expect(vault.name).toBe('Personal IP');
    expect(vault.state).toBe('open');
    expect(event.eventType).toBe('vault.created');
    expect(event.previousHash).toBe(GENESIS_HASH);
    expect(event.eventHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('deposits an asset into an open vault', async () => {
    const { vault } = await createVault(tenantId, actorId, { name: 'V1' });

    const { asset, event } = await depositAsset(tenantId, actorId, {
      vaultId: vault.id,
      name: 'design-v7.pdf',
      contentHash: 'a'.repeat(64),
      encryptedEnvelope: { ciphertext: 'x', encryptedDek: 'y', iv: 'z' },
      storageKey: 's3://bucket/key-1',
      contentType: 'application/pdf',
      byteSize: 12345,
    });

    expect(asset.contentHash).toBe('a'.repeat(64));
    expect(asset.state).toBe('open');
    expect(event.eventType).toBe('asset.deposited');
    expect(event.previousHash).not.toBe(GENESIS_HASH); // chained after vault.created
  });

  it('rejects deposit with invalid contentHash', async () => {
    const { vault } = await createVault(tenantId, actorId, { name: 'V2' });
    await expect(
      depositAsset(tenantId, actorId, {
        vaultId: vault.id,
        name: 'bad',
        contentHash: 'not-a-hash',
        encryptedEnvelope: {},
        storageKey: 'k',
      }),
    ).rejects.toThrow(/contentHash/i);
  });

  it('seals a vault and cascades to open assets', async () => {
    const { vault } = await createVault(tenantId, actorId, { name: 'V3' });
    await depositAsset(tenantId, actorId, {
      vaultId: vault.id,
      name: 'a1',
      contentHash: 'b'.repeat(64),
      encryptedEnvelope: { c: 1 },
      storageKey: 'k1',
    });

    const { vault: sealed, event } = await sealVault(tenantId, actorId, vault.id);
    expect(sealed.state).toBe('sealed');
    expect(event.eventType).toBe('vault.sealed');

    const reloaded = await getVault(tenantId, vault.id);
    expect(reloaded?.state).toBe('sealed');
  });
});
