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
    if (sql.includes('FROM custody_events') && sql.includes('DESC')) {
      const list = events
        .filter((e) => e.scope_id === params[1])
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      return list[0] ? [list[0]] : [];
    }
    if (sql.startsWith('UPDATE custody_vaults')) {
      const v = vaults.find((x) => x.id === params[0]);
      if (!v) return [];
      v.state = 'released';
      v.released_at = new Date().toISOString();
      return [v];
    }
    if (sql.startsWith('UPDATE custody_assets') && sql.includes('vault_id')) {
      for (const a of assets) {
        if (a.vault_id === params[0] && a.state === 'sealed') a.state = 'released';
      }
      return [];
    }
    if (sql.startsWith('UPDATE custody_assets') && sql.includes('WHERE id')) {
      const a = assets.find((x) => x.id === params[0]);
      if (!a) return [];
      a.state = 'released';
      return [a];
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

import { releaseVault, releaseAsset } from '../release';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';
const vaultId = '00000000-0000-4000-8000-0000000000v1';
const assetId = '00000000-0000-4000-8000-0000000000a1';

describe('release', () => {
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
      name: 'a',
      content_hash: 'ab'.repeat(32),
      encrypted_envelope: {},
      storage_key: 'k',
      state: 'sealed',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      sealed_at: new Date().toISOString(),
      destroyed_at: null,
    });
  });

  it('releases a sealed vault', async () => {
    const { vault, event } = await releaseVault(tenantId, actorId, vaultId, 'owner request');
    expect(vault.state).toBe('released');
    expect(event.eventType).toBe('vault.released');
  });

  it('rejects release from open state', async () => {
    vaults[0].state = 'open';
    await expect(releaseVault(tenantId, actorId, vaultId)).rejects.toThrow(/must be sealed/i);
  });

  it('releases a sealed asset', async () => {
    const { asset, event } = await releaseAsset(tenantId, actorId, assetId);
    expect(asset.state).toBe('released');
    expect(event.eventType).toBe('asset.released');
  });
});
