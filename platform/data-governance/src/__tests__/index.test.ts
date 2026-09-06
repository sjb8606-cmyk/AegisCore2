import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../tenancy/src/index', () => ({
  withTenantQuery: vi.fn(),
}));
vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(),
}));

import { withTenantQuery } from '../../tenancy/src/index';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const ASSET_ID = '33333333-3333-3333-3333-333333333333';

async function freshService(cfg?: any) {
  vi.resetModules();
  if (cfg) {
    const fs = await import('fs');
    (fs.existsSync as any).mockReturnValueOnce(true);
    (fs.readFileSync as any).mockReturnValueOnce(JSON.stringify(cfg));
  }
  const mod = await import('../index');
  return mod.DataGovernanceService;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('classifyDataAsset', () => {
  it('blocks when the engine is globally disabled', async () => {
    const svc = await freshService({ enabled: false, tiers: {}, limits: {} });
    await expect(svc.classifyDataAsset(TENANT_ID, { asset_type: 'table', asset_id: ASSET_ID })).rejects.toThrow(
      'Data governance engine is globally disabled'
    );
    expect(withTenantQuery).not.toHaveBeenCalled();
  });

  it('blocks when the classificationEngine tier is off', async () => {
    const svc = await freshService({ enabled: true, tiers: { classificationEngine: false }, limits: {} });
    await expect(svc.classifyDataAsset(TENANT_ID, { asset_type: 'table', asset_id: ASSET_ID })).rejects.toThrow(
      'Classification features are blocked on current tier'
    );
  });

  it('rejects an invalid asset_id via schema validation', async () => {
    const svc = await freshService();
    await expect(svc.classifyDataAsset(TENANT_ID, { asset_type: 'table', asset_id: 'not-a-uuid' })).rejects.toThrow();
    expect(withTenantQuery).not.toHaveBeenCalled();
  });

  // DEFECT — documented, not hidden. Despite piiDetection and
  // classificationEngine being real configured tiers, no classification
  // logic exists anywhere in this file. Every asset is inserted with the
  // literal string 'pending' and nothing here ever advances it — there's no
  // PII scan, no sensitivity detection, nothing.
  it('DEFECT: classification is always the hardcoded literal "pending", never actually classified', async () => {
    const svc = await freshService();
    (withTenantQuery as any).mockResolvedValueOnce([{ id: 'asset-1', classification: 'pending' }]);

    await svc.classifyDataAsset(TENANT_ID, { asset_type: 'table', asset_id: ASSET_ID, metadata: { contains_ssn: true } });

    const insertParams = (withTenantQuery as any).mock.calls[0][1];
    expect(insertParams).toEqual([TENANT_ID, 'table', ASSET_ID, JSON.stringify({ contains_ssn: true })]);
    // TODO(data-governance launch blocker): implement actual PII detection /
    // classification logic instead of a permanent 'pending' placeholder.
  });
});

describe('recordAccess', () => {
  it('blocks when the accessLogging tier is off', async () => {
    const svc = await freshService({ enabled: true, tiers: { accessLogging: false }, limits: {} });
    await expect(svc.recordAccess(TENANT_ID, USER_ID, ASSET_ID, 'read')).rejects.toThrow(
      'Governance access logging is blocked on current tier'
    );
  });

  // GAP — documented, not hidden. Unlike classifyDataAsset (which validates
  // asset_id via a zod schema), recordAccess passes userId and assetId
  // straight into ::uuid casts with no prior validation at all.
  it('GAP: userId and assetId are never validated before being cast to ::uuid', async () => {
    const svc = await freshService();
    (withTenantQuery as any).mockRejectedValueOnce(new Error('invalid input syntax for type uuid'));
    await expect(svc.recordAccess(TENANT_ID, 'not-a-uuid', ASSET_ID, 'read')).rejects.toThrow(
      'invalid input syntax for type uuid'
    );
    // TODO(data-governance): validate userId/assetId with parseUserId()/isValidUuid()
    // before they reach the query, consistent with classifyDataAsset's approach.
  });

  it('records an access log row and returns it', async () => {
    const svc = await freshService();
    const row = { id: 'log-1', action: 'read' };
    (withTenantQuery as any).mockResolvedValueOnce([row]);
    const result = await svc.recordAccess(TENANT_ID, USER_ID, ASSET_ID, 'read');
    expect(result).toEqual(row);
  });
});

describe('fetchAssets', () => {
  it('returns rows for the tenant', async () => {
    const rows = [{ id: ASSET_ID, classification: 'pending' }];
    (withTenantQuery as any).mockResolvedValueOnce(rows);
    const svc = await freshService();
    const result = await svc.fetchAssets(TENANT_ID);
    expect(result).toEqual(rows);
  });
});
