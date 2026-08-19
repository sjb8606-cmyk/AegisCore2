/**
 * custody-receipt tests (mocked tenancy)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as crypto from 'crypto';

const assets: any[] = [];
const vaults: any[] = [];
const events: any[] = [];

vi.mock('@platform/tenancy', () => ({
  withTenantQuery: vi.fn(async (sql: string, params: any[]) => {
    if (sql.includes('FROM custody_assets WHERE id') && sql.includes('JOIN') === false) {
      const a = assets.find((x) => x.id === params[0]);
      return a ? [a] : [];
    }
    if (sql.includes('JOIN custody_vaults')) {
      const a = assets.find((x) => x.id === params[0]);
      if (!a) return [];
      const v = vaults.find((x) => x.id === a.vault_id);
      return [{ ...a, vault_state: v?.state ?? 'open' }];
    }
    if (sql.includes('FROM custody_vaults WHERE id')) {
      const v = vaults.find((x) => x.id === params[0]);
      return v ? [v] : [];
    }
    if (sql.includes('COUNT(*)')) {
      return [{ count: String(assets.filter((a) => a.vault_id === params[1]).length) }];
    }
    if (sql.includes('FROM custody_events') && sql.includes('ORDER BY created_at DESC')) {
      const list = events
        .filter((e) => e.scope_id === params[1])
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      return list[0] ? [list[0]] : [];
    }
    if (sql.includes('FROM custody_events') && sql.includes('ORDER BY created_at ASC')) {
      return events
        .filter((e) => e.scope_id === params[1])
        .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
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
    loadConfig: vi.fn().mockReturnValue({ enabled: true }),
  };
});

vi.mock('@platform/observability', () => ({
  getLogger: () => ({
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  }),
}));

import {
  issueAssetReceipt,
  issueVaultReceipt,
  verifyReceipt,
  getAuthorizedAssetView,
} from '../index';
import { computeChainHash, GENESIS_HASH } from '@platform/hash-chain';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';
const vaultId = '00000000-0000-4000-8000-0000000000v1';
const assetId = '00000000-0000-4000-8000-0000000000a1';

describe('custody-receipt', () => {
  beforeEach(() => {
    assets.length = 0;
    vaults.length = 0;
    events.length = 0;

    vaults.push({
      id: vaultId,
      tenant_id: tenantId,
      owner_id: actorId,
      name: 'IP Vault',
      state: 'sealed',
      sealed_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    });

    assets.push({
      id: assetId,
      tenant_id: tenantId,
      vault_id: vaultId,
      name: 'design-v7.pdf',
      content_type: 'application/pdf',
      byte_size: 999,
      content_hash: 'ab'.repeat(32),
      encrypted_envelope: { ciphertext: 'x' },
      storage_key: 's3://k/1',
      state: 'sealed',
      created_at: new Date().toISOString(),
      sealed_at: new Date().toISOString(),
    });

    const payload = { name: 'IP Vault', state: 'open' };
    const h1 = computeChainHash(vaultId, 'vault.created', payload, GENESIS_HASH);
    events.push({
      id: crypto.randomUUID(),
      scope_id: vaultId,
      event_type: 'vault.created',
      payload,
      previous_hash: GENESIS_HASH,
      event_hash: h1,
      created_at: new Date(Date.now() - 1000).toISOString(),
    });

    const payload2 = { assetId, contentHash: 'ab'.repeat(32) };
    const h2 = computeChainHash(vaultId, 'asset.deposited', payload2, h1);
    events.push({
      id: crypto.randomUUID(),
      scope_id: vaultId,
      event_type: 'asset.deposited',
      payload: payload2,
      previous_hash: h1,
      event_hash: h2,
      created_at: new Date().toISOString(),
    });
  });

  it('issues an asset receipt with matching receiptHash', async () => {
    const receipt = await issueAssetReceipt(tenantId, actorId, assetId);
    expect(receipt.kind).toBe('asset');
    expect(receipt.subject).toEqual(
      expect.objectContaining({ assetId, contentHash: 'ab'.repeat(32) }),
    );
    expect(receipt.receiptHash).toMatch(/^[0-9a-f]{64}$/);
    expect(receipt.chainTip.eventHash).toBe(events[1].event_hash);
  });

  it('verifies a fresh receipt against the chain', async () => {
    const receipt = await issueAssetReceipt(tenantId, actorId, assetId);
    const result = await verifyReceipt(tenantId, receipt);
    expect(result.receiptHashValid).toBe(true);
    expect(result.chainValid).toBe(true);
  });

  it('detects receipt tampering', async () => {
    const receipt = await issueAssetReceipt(tenantId, actorId, assetId);
    (receipt.subject as any).contentHash = '00'.repeat(32);
    const result = await verifyReceipt(tenantId, receipt, { verifyChain: false });
    expect(result.receiptHashValid).toBe(false);
  });

  it('returns authorized asset view without plaintext', async () => {
    const view = await getAuthorizedAssetView(tenantId, actorId, assetId);
    expect(view.storageKey).toBe('s3://k/1');
    expect(view.contentHash).toBe('ab'.repeat(32));
    expect(view).not.toHaveProperty('plaintext');
  });

  it('issues vault receipt with asset count', async () => {
    const receipt = await issueVaultReceipt(tenantId, actorId, vaultId);
    expect(receipt.kind).toBe('vault');
    expect((receipt.subject as any).assetCount).toBe(1);
  });
});
