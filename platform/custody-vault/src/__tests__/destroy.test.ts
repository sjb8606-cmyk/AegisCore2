import { describe, it, expect, vi, beforeEach } from 'vitest';

const vaults: any[] = [];
const assets: any[] = [];
const events: any[] = [];

vi.mock('@platform/tenancy', () => ({
  withTenantQuery: vi.fn(async (sql: string, params: any[]) => {
    if (sql.includes('FROM custody_vaults WHERE id')) {
      const v = vaults.find((x) => x.id === params[0]);
      return v ? [v] : [];
    }
    if (sql.includes('FROM custody_assets WHERE id')) {
      const a = assets.find((x) => x.id === params[0]);
      return a ? [a] : [];
    }
    if (sql.includes('SELECT id, storage_key, state FROM custody_assets')) {
      return assets.filter((a) => a.vault_id === params[1] && a.state !== 'destroyed');
    }
    if (sql.includes('FROM custody_events') && sql.includes('DESC')) {
      const list = events
        .filter((e) => e.scope_id === params[1])
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      return list[0] ? [list[0]] : [];
    }
    if (sql.startsWith('UPDATE custody_assets') && sql.includes('WHERE id')) {
      const a = assets.find((x) => x.id === params[0]);
      if (!a) return [];
      a.state = 'destroyed';
      a.storage_key = '';
      a.encrypted_envelope = {};
      a.destroyed_at = new Date().toISOString();
      return [a];
    }
    if (sql.startsWith('UPDATE custody_assets') && sql.includes('vault_id')) {
      for (const a of assets) {
        if (a.vault_id === params[1] && a.state !== 'destroyed') {
          a.state = 'destroyed';
          a.storage_key = '';
          a.encrypted_envelope = {};
        }
      }
      return [];
    }
    if (sql.startsWith('UPDATE custody_vaults')) {
      const v = vaults.find((x) => x.id === params[0]);
      if (!v) return [];
      v.state = 'destroyed';
      v.destroyed_at = new Date().toISOString();
      return [v];
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
        actor_type: 'user',
        payload: JSON.parse(params[7]),
        previous_hash: params[8],
        event_hash: params[9],
        created_at: new Date().toISOString(),
      };
      events.push(row);
      return [row];
    }
    return [];
  }),
}));

vi.mock('@platform/audit', () => ({ emit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@platform/metering', () => ({ recordUsage: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@platform/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platform/utils')>();
  return { ...actual, loadConfig: vi.fn().mockReturnValue({ enabled: true, limits: {} }) };
});
vi.mock('@platform/observability', () => ({
  getLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { destroyAsset, destroyVault } from '../destroy';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';
const vaultId = '00000000-0000-4000-8000-0000000000v1';
const assetId = '00000000-0000-4000-8000-0000000000a1';

describe('destroy', () => {
  beforeEach(() => {
    vaults.length = 0;
    assets.length = 0;
    events.length = 0;
    vaults.push({
      id: vaultId,
      tenant_id: tenantId,
      owner_id: actorId,
      name: 'V',
      state: 'sealed',
      policy: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      sealed_at: new Date().toISOString(),
      released_at: null,
      destroyed_at: null,
    });
    assets.push({
      id: assetId,
      tenant_id: tenantId,
      vault_id: vaultId,
      name: 'secret.pdf',
      content_hash: 'cd'.repeat(32),
      encrypted_envelope: { ciphertext: 'x' },
      storage_key: 's3://bucket/key-1',
      state: 'sealed',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      sealed_at: new Date().toISOString(),
      destroyed_at: null,
    });
  });

  it('destroys an asset and returns storage key for external deletion', async () => {
    const result = await destroyAsset(tenantId, actorId, assetId, 'no longer needed');
    expect(result.asset.state).toBe('destroyed');
    expect(result.asset.storageKey).toBe('');
    expect(result.storageKeysToDelete).toEqual(['s3://bucket/key-1']);
    expect(result.event.eventType).toBe('asset.destroyed');
    // provenance hash retained
    expect(result.asset.contentHash).toBe('cd'.repeat(32));
  });

  it('destroys a vault and all child assets', async () => {
    const result = await destroyVault(tenantId, actorId, vaultId);
    expect(result.vault.state).toBe('destroyed');
    expect(result.storageKeysToDelete).toContain('s3://bucket/key-1');
    expect(result.event.eventType).toBe('vault.destroyed');
  });

  it('rejects double-destroy', async () => {
    await destroyAsset(tenantId, actorId, assetId);
    await expect(destroyAsset(tenantId, actorId, assetId)).rejects.toThrow(/already destroyed/i);
  });
});
