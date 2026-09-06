import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@platform/tenancy', () => ({
  withTenantQuery: vi.fn(),
}));
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import { createAsset, assignAsset, returnAsset, disposeAsset } from '../index';
import { withTenantQuery } from '@platform/tenancy';
import * as fs from 'fs';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const ADMIN_ID = '33333333-3333-3333-3333-333333333333';
const ASSET_ID = '44444444-4444-4444-4444-444444444444';

function mockConfig(cfg: any) {
  (fs.existsSync as any).mockReturnValue(true);
  (fs.readFileSync as any).mockReturnValue(JSON.stringify(cfg));
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('createAsset', () => {
  it('blocks when asset management is disabled', async () => {
    mockConfig({ enabled: false, tiers: {}, limits: { assets: 100 } });
    await expect(createAsset(TENANT_ID, { name: 'Laptop' })).rejects.toThrow('Asset management disabled');
    expect(withTenantQuery).not.toHaveBeenCalled();
  });

  it('enforces the asset registry limit', async () => {
    mockConfig({ enabled: true, tiers: {}, limits: { assets: 2 } });
    (withTenantQuery as any).mockResolvedValueOnce([{ count: '2' }]);
    await expect(createAsset(TENANT_ID, { name: 'Laptop' })).rejects.toThrow('Asset registry limits reached');
  });

  it('auto-generates an asset_tag when none is provided', async () => {
    mockConfig({ enabled: true, tiers: {}, limits: { assets: 100 } });
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ count: '0' }])
      .mockResolvedValueOnce([{ id: ASSET_ID }]);

    await createAsset(TENANT_ID, { name: 'Laptop' });

    const params = (withTenantQuery as any).mock.calls[1][1];
    expect(params[2]).toMatch(/^AST-[0-9A-F]{8}$/);
  });

  it('uses the caller-supplied asset_tag when given', async () => {
    mockConfig({ enabled: true, tiers: {}, limits: { assets: 100 } });
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ count: '0' }])
      .mockResolvedValueOnce([{ id: ASSET_ID }]);

    await createAsset(TENANT_ID, { name: 'Laptop', asset_tag: 'CUSTOM-001' });

    const params = (withTenantQuery as any).mock.calls[1][1];
    expect(params[2]).toBe('CUSTOM-001');
  });
});

describe('assignAsset', () => {
  it('blocks when assetAssignments tier is disabled', async () => {
    mockConfig({ enabled: true, tiers: { assetAssignments: false } });
    await expect(assignAsset(TENANT_ID, ASSET_ID, USER_ID, ADMIN_ID)).rejects.toThrow('Asset assignments disabled');
    expect(withTenantQuery).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND when the asset does not exist', async () => {
    mockConfig({ enabled: true, tiers: { assetAssignments: true } });
    (withTenantQuery as any).mockResolvedValueOnce([]);
    await expect(assignAsset(TENANT_ID, ASSET_ID, USER_ID, ADMIN_ID)).rejects.toThrow('Asset not found');
  });

  it('rejects assignment when the asset is not active', async () => {
    mockConfig({ enabled: true, tiers: { assetAssignments: true } });
    (withTenantQuery as any).mockResolvedValueOnce([{ status: 'disposed', assigned_to: null }]);
    await expect(assignAsset(TENANT_ID, ASSET_ID, USER_ID, ADMIN_ID)).rejects.toThrow(
      'Asset is not in an active state for assignment'
    );
  });

  it('rejects assignment when the asset is already assigned out', async () => {
    mockConfig({ enabled: true, tiers: { assetAssignments: true } });
    (withTenantQuery as any).mockResolvedValueOnce([{ status: 'active', assigned_to: 'someone-else' }]);
    await expect(assignAsset(TENANT_ID, ASSET_ID, USER_ID, ADMIN_ID)).rejects.toThrow('Asset is already assigned out');
  });

  it('creates an assignment and updates the asset when valid', async () => {
    mockConfig({ enabled: true, tiers: { assetAssignments: true } });
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ status: 'active', assigned_to: null }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: ASSET_ID, assigned_to: USER_ID }]);

    const result = await assignAsset(TENANT_ID, ASSET_ID, USER_ID, ADMIN_ID);

    expect(result.success).toBe(true);
    expect(result.asset.assigned_to).toBe(USER_ID);
  });
});

describe('returnAsset', () => {
  it('throws NOT_FOUND when the asset does not exist', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);
    await expect(returnAsset(TENANT_ID, ASSET_ID)).rejects.toThrow('Asset not found');
  });

  it('rejects when the asset is not currently assigned', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ assigned_to: null }]);
    await expect(returnAsset(TENANT_ID, ASSET_ID)).rejects.toThrow('Asset is not currently assigned');
  });

  it('closes the assignment and clears assigned_to when valid', async () => {
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ assigned_to: USER_ID }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: ASSET_ID, assigned_to: null }]);

    const result = await returnAsset(TENANT_ID, ASSET_ID);

    expect(result.asset.assigned_to).toBeNull();
  });
});

describe('disposeAsset', () => {
  it('blocks when disposalWorkflow tier is disabled', async () => {
    mockConfig({ enabled: true, tiers: { disposalWorkflow: false } });
    await expect(disposeAsset(TENANT_ID, ASSET_ID, 'end of life', ADMIN_ID)).rejects.toThrow(
      'Disposal workflow disabled'
    );
  });

  it('refuses to dispose an actively assigned asset', async () => {
    mockConfig({ enabled: true, tiers: { disposalWorkflow: true } });
    (withTenantQuery as any).mockResolvedValueOnce([{ status: 'active', assigned_to: USER_ID }]);
    await expect(disposeAsset(TENANT_ID, ASSET_ID, 'end of life', ADMIN_ID)).rejects.toThrow(
      'Cannot dispose an actively assigned asset. Return it first.'
    );
  });

  it('refuses to dispose an already-disposed asset', async () => {
    mockConfig({ enabled: true, tiers: { disposalWorkflow: true } });
    (withTenantQuery as any).mockResolvedValueOnce([{ status: 'disposed', assigned_to: null }]);
    await expect(disposeAsset(TENANT_ID, ASSET_ID, 'end of life', ADMIN_ID)).rejects.toThrow('Asset already disposed');
  });

  it('records the disposal and sets asset status to disposed', async () => {
    mockConfig({ enabled: true, tiers: { disposalWorkflow: true } });
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ status: 'active', assigned_to: null }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: ASSET_ID, status: 'disposed' }]);

    const result = await disposeAsset(TENANT_ID, ASSET_ID, 'end of life', ADMIN_ID);

    expect(result.asset.status).toBe('disposed');
    const disposalParams = (withTenantQuery as any).mock.calls[1][1];
    expect(disposalParams[3]).toBe('end of life');
  });
});
