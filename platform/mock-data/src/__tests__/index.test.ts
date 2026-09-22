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

import { createTemplate, listTemplates, generateMockData } from '../index';

const TENANT = '11111111-1111-1111-1111-111111111111';
const ACTOR = '22222222-2222-2222-2222-222222222222';
const TEMPLATE_ID = '33333333-3333-3333-3333-333333333333';

function defaultTier(over: Record<string, unknown> = {}) {
  return {
    enabled: true,
    tiers: {
      generateRecords: true,
      seedTemplates: true,
      bulkGenerate: true,
      resetTenantData: false,
      ...(over.tiers as object),
    },
    limits: {
      maxRecordsPerGenerate: 500,
      maxTemplatesPerTenant: 50,
      ...(over.limits as object),
    },
  };
}

beforeEach(() => {
  mockWithTenantQuery.mockReset();
  mockGetTierConfig.mockReset();
  mockGetTierConfig.mockResolvedValue(defaultTier());
});

describe('createTemplate', () => {
  it('creates a template', async () => {
    mockWithTenantQuery
      .mockResolvedValueOnce([{ cnt: 0 }])
      .mockResolvedValueOnce([{ id: TEMPLATE_ID, key: 'contacts' }]);
    const row = await createTemplate(TENANT, {
      key: 'contacts',
      name: 'Contacts',
      entity_type: 'contact',
      field_specs: [{ key: 'email', type: 'email' }],
    }, ACTOR);
    expect(row.key).toBe('contacts');
  });

  it('rejects invalid key', async () => {
    await expect(
      createTemplate(TENANT, {
        key: 'Bad-Key', name: 'X', entity_type: 'x',
        field_specs: [{ key: 'a', type: 'string' }],
      }, ACTOR),
    ).rejects.toThrow();
  });

  it('throws FORBIDDEN when disabled', async () => {
    mockGetTierConfig.mockResolvedValue({ enabled: false, tiers: {}, limits: {} });
    await expect(
      createTemplate(TENANT, {
        key: 'contacts', name: 'Contacts', entity_type: 'contact',
        field_specs: [{ key: 'email', type: 'email' }],
      }, ACTOR),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('listTemplates', () => {
  it('lists templates', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([{ id: TEMPLATE_ID }]);
    const rows = await listTemplates(TENANT);
    expect(rows).toHaveLength(1);
  });
});

describe('generateMockData', () => {
  it('generates from inline field_specs', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([{ id: 'run-1', record_count: 3 }]);
    const result = await generateMockData(TENANT, {
      entity_type: 'contact',
      count: 3,
      field_specs: [
        { key: 'email', type: 'email' },
        { key: 'name', type: 'string' },
      ],
    }, ACTOR);
    expect(result.records).toHaveLength(3);
    expect(result.records[0].email).toMatch(/@example\.test$/);
    expect(result.run.record_count).toBe(3);
  });

  it('generates from template_id', async () => {
    mockWithTenantQuery
      .mockResolvedValueOnce([{
        id: TEMPLATE_ID,
        entity_type: 'contact',
        field_specs: [{ key: 'email', type: 'email' }],
      }])
      .mockResolvedValueOnce([{ id: 'run-2', record_count: 2 }]);
    const result = await generateMockData(TENANT, {
      template_id: TEMPLATE_ID,
      count: 2,
    }, ACTOR);
    expect(result.records).toHaveLength(2);
  });

  it('throws NOT_FOUND for missing template', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([]);
    await expect(
      generateMockData(TENANT, { template_id: TEMPLATE_ID, count: 1 }, ACTOR),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('requires bulkGenerate for large counts', async () => {
    mockGetTierConfig.mockResolvedValue(defaultTier({ tiers: { bulkGenerate: false } }));
    await expect(
      generateMockData(TENANT, {
        entity_type: 'contact',
        count: 100,
        field_specs: [{ key: 'n', type: 'string' }],
      }, ACTOR),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects invalid tenant id', async () => {
    await expect(
      generateMockData('bad', {
        entity_type: 'x', count: 1, field_specs: [{ key: 'a', type: 'string' }],
      }, ACTOR),
    ).rejects.toMatchObject({ message: expect.stringMatching(/invalid tenant/i) });
  });
});
