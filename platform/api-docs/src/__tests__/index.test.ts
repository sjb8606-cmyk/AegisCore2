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
  registerEndpoint,
  listEndpoints,
  generateOpenApi,
  listDocVersions,
  getDocVersion,
} from '../index';

const TENANT = '11111111-1111-1111-1111-111111111111';
const ACTOR = '22222222-2222-2222-2222-222222222222';

function defaultTier(over: Record<string, unknown> = {}) {
  return {
    enabled: true,
    tiers: {
      registerEndpoints: true,
      generateOpenApi: true,
      versioning: true,
      publishDocs: true,
      ...(over.tiers as object),
    },
    limits: {
      maxEndpointsPerTenant: 500,
      maxVersionsRetained: 20,
      ...(over.limits as object),
    },
  };
}

beforeEach(() => {
  mockWithTenantQuery.mockReset();
  mockGetTierConfig.mockReset();
  mockGetTierConfig.mockResolvedValue(defaultTier());
});

describe('registerEndpoint', () => {
  it('registers an endpoint', async () => {
    mockWithTenantQuery
      .mockResolvedValueOnce([{ cnt: 0 }])
      .mockResolvedValueOnce([{ id: 'ep-1', method: 'POST', path: '/orders' }]);
    const row = await registerEndpoint(TENANT, {
      method: 'POST', path: '/orders', summary: 'Create order',
    }, ACTOR);
    expect(row.path).toBe('/orders');
  });

  it('rejects path without leading slash', async () => {
    await expect(
      registerEndpoint(TENANT, { method: 'GET', path: 'orders' }, ACTOR),
    ).rejects.toThrow();
  });

  it('throws FORBIDDEN when disabled', async () => {
    mockGetTierConfig.mockResolvedValue({ enabled: false, tiers: {}, limits: {} });
    await expect(
      registerEndpoint(TENANT, { method: 'GET', path: '/x' }, ACTOR),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('listEndpoints', () => {
  it('lists endpoints', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([{ path: '/orders' }]);
    const rows = await listEndpoints(TENANT);
    expect(rows).toHaveLength(1);
  });
});

describe('generateOpenApi', () => {
  it('builds an OpenAPI document', async () => {
    mockWithTenantQuery
      .mockResolvedValueOnce([
        {
          method: 'POST', path: '/orders', summary: 'Create',
          tags: '["orders"]', auth_required: true,
          request_schema: { type: 'object' },
          response_schema: { type: 'object' },
        },
      ])
      .mockResolvedValueOnce([{ id: 'v1', version: '1.0.0', published: false }]);

    const result = await generateOpenApi(TENANT, {
      title: 'Demo API', version: '1.0.0', publish: false,
    }, ACTOR);

    expect(result.openapi.openapi).toBe('3.0.3');
    expect(result.openapi.info.title).toBe('Demo API');
    expect(result.openapi.paths['/orders'].post).toBeTruthy();
    expect(result.openapi.paths['/orders'].post.security).toEqual([{ bearerAuth: [] }]);
  });

  it('requires publishDocs tier when publish=true', async () => {
    mockGetTierConfig.mockResolvedValue(defaultTier({ tiers: { publishDocs: false } }));
    await expect(
      generateOpenApi(TENANT, { publish: true }, ACTOR),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('listDocVersions / getDocVersion', () => {
  it('lists versions', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([{ version: '1.0.0' }]);
    const rows = await listDocVersions(TENANT);
    expect(rows).toHaveLength(1);
  });

  it('gets a version', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([{ version: '1.0.0', openapi_doc: {} }]);
    const row = await getDocVersion(TENANT, '1.0.0');
    expect(row.version).toBe('1.0.0');
  });

  it('throws NOT_FOUND', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([]);
    await expect(getDocVersion(TENANT, '9.9.9')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
