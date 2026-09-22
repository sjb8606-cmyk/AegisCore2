import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWithTenantQuery = vi.fn();
const mockGetTierConfig = vi.fn();

vi.mock('@platform/tenancy', () => ({
  withTenantQuery: (...args: unknown[]) => mockWithTenantQuery(...args),
}));

vi.mock('@platform/entitlements', () => ({
  getTierConfig: (...args: unknown[]) => mockGetTierConfig(...args),
}));

vi.mock('@platform/utils', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@platform/utils');
  return { ...actual };
});

import {
  createEnvironment,
  listEnvironments,
  getEnvironment,
  setVariable,
  listVariables,
  requestPromotion,
  approvePromotion,
} from '../index';

const TENANT = '11111111-1111-1111-1111-111111111111';
const ACTOR = '22222222-2222-2222-2222-222222222222';
const ENV_ID = '33333333-3333-3333-3333-333333333333';
const ENV_ID_2 = '44444444-4444-4444-4444-444444444444';
const PROMO_ID = '55555555-5555-5555-5555-555555555555';

function defaultTier(over: Record<string, unknown> = {}) {
  return {
    enabled: true,
    tiers: {
      environmentRegistration: true,
      variableManagement: true,
      secretManagement: true,
      promotionPipeline: true,
      promotionGates: true,
      activityLog: true,
      ...(over.tiers as object),
    },
    limits: {
      environmentsPerTenant: 20,
      variablesPerEnvironment: 200,
      ...(over.limits as object),
    },
  };
}

beforeEach(() => {
  mockWithTenantQuery.mockReset();
  mockGetTierConfig.mockReset();
  mockGetTierConfig.mockResolvedValue(defaultTier());
});

describe('createEnvironment', () => {
  it('creates an environment', async () => {
    mockWithTenantQuery
      .mockResolvedValueOnce([{ cnt: 0 }]) // quota
      .mockResolvedValueOnce([{ id: ENV_ID, name: 'dev', type: 'development' }]) // insert
      .mockResolvedValueOnce([]); // activity log

    const env = await createEnvironment(TENANT, { name: 'dev', type: 'development' }, ACTOR);
    expect(env.name).toBe('dev');
  });

  it('rejects invalid type', async () => {
    await expect(
      createEnvironment(TENANT, { name: 'x', type: 'prod' }, ACTOR),
    ).rejects.toThrow();
  });

  it('throws FORBIDDEN when disabled', async () => {
    mockGetTierConfig.mockResolvedValue({ enabled: false, tiers: {}, limits: {} });
    await expect(
      createEnvironment(TENANT, { name: 'dev', type: 'development' }, ACTOR),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects invalid tenant id', async () => {
    await expect(
      createEnvironment('bad', { name: 'dev', type: 'development' }, ACTOR),
    ).rejects.toMatchObject({ message: expect.stringMatching(/invalid tenant/i) });
  });
});

describe('getEnvironment', () => {
  it('returns env when found', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([{ id: ENV_ID, name: 'dev' }]);
    const env = await getEnvironment(TENANT, ENV_ID);
    expect(env.id).toBe(ENV_ID);
  });

  it('throws NOT_FOUND', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([]);
    await expect(getEnvironment(TENANT, ENV_ID)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('setVariable', () => {
  it('upserts a variable', async () => {
    mockWithTenantQuery
      .mockResolvedValueOnce([{ id: ENV_ID }]) // getEnvironment
      .mockResolvedValueOnce([{ cnt: 0 }])     // count
      .mockResolvedValueOnce([])               // existing
      .mockResolvedValueOnce([{ id: 'v1', key: 'API_URL', is_secret: false, value: 'https://x' }])
      .mockResolvedValueOnce([]);              // activity

    const row = await setVariable(
      TENANT, ENV_ID,
      { key: 'API_URL', value: 'https://x', is_secret: false },
      ACTOR,
    );
    expect(row.key).toBe('API_URL');
  });

  it('requires secretManagement tier for secrets', async () => {
    mockGetTierConfig.mockResolvedValue(
      defaultTier({ tiers: { secretManagement: false } }),
    );
    // getEnvironment still runs after variableManagement check
    // secretManagement check happens after parse
    await expect(
      setVariable(TENANT, ENV_ID, { key: 'SECRET', value: 's', is_secret: true }, ACTOR),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('listVariables', () => {
  it('redacts secrets by default', async () => {
    mockWithTenantQuery
      .mockResolvedValueOnce([{ id: ENV_ID }]) // getEnvironment
      .mockResolvedValueOnce([
        { key: 'PUBLIC', is_secret: false, value: 'ok' },
        { key: 'SECRET', is_secret: true, value: null },
      ]);

    const rows = await listVariables(TENANT, ENV_ID);
    expect(rows.find((r: any) => r.key === 'SECRET')?.value).toBeNull();
  });
});

describe('promotions', () => {
  it('requestPromotion creates pending promotion', async () => {
    mockWithTenantQuery
      .mockResolvedValueOnce([{ id: ENV_ID }])     // source get
      .mockResolvedValueOnce([{ id: ENV_ID_2 }])   // target get
      .mockResolvedValueOnce([{ id: PROMO_ID, status: 'pending_approval' }])
      .mockResolvedValueOnce([]); // activity

    const promo = await requestPromotion(
      TENANT,
      { source_env_id: ENV_ID, target_env_id: ENV_ID_2 },
      ACTOR,
    );
    expect(promo.status).toBe('pending_approval');
  });

  it('rejects same source and target', async () => {
    await expect(
      requestPromotion(TENANT, { source_env_id: ENV_ID, target_env_id: ENV_ID }, ACTOR),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('approvePromotion completes a pending promotion', async () => {
    mockWithTenantQuery
      .mockResolvedValueOnce([{ id: PROMO_ID, status: 'pending_approval', source_env_id: ENV_ID, target_env_id: ENV_ID_2 }])
      .mockResolvedValueOnce([]) // copy vars
      .mockResolvedValueOnce([{ id: PROMO_ID, status: 'completed', source_env_id: ENV_ID, target_env_id: ENV_ID_2 }])
      .mockResolvedValueOnce([]); // activity

    const promo = await approvePromotion(TENANT, PROMO_ID, ACTOR);
    expect(promo.status).toBe('completed');
  });

  it('approvePromotion rejects non-pending', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([
      { id: PROMO_ID, status: 'completed' },
    ]);
    await expect(approvePromotion(TENANT, PROMO_ID, ACTOR)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('approvePromotion NOT_FOUND', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([]);
    await expect(approvePromotion(TENANT, PROMO_ID, ACTOR)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
