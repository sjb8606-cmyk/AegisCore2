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
  createSchema,
  getSchema,
  listSchemas,
  addField,
  listFields,
  publishSchema,
} from '../index';

const TENANT = '11111111-1111-1111-1111-111111111111';
const ACTOR = '22222222-2222-2222-2222-222222222222';
const SCHEMA_ID = '33333333-3333-3333-3333-333333333333';

function defaultTier(over: Record<string, unknown> = {}) {
  return {
    enabled: true,
    tiers: {
      customFields: true,
      sections: true,
      fileFields: true,
      validationRules: true,
      versioning: true,
      ...(over.tiers as object),
    },
    limits: {
      schemasPerTenant: 100,
      fieldsPerSchema: 100,
      ...(over.limits as object),
    },
  };
}

beforeEach(() => {
  mockWithTenantQuery.mockReset();
  mockGetTierConfig.mockReset();
  mockGetTierConfig.mockResolvedValue(defaultTier());
});

describe('createSchema', () => {
  it('creates a schema', async () => {
    mockWithTenantQuery
      .mockResolvedValueOnce([{ cnt: 0 }])
      .mockResolvedValueOnce([{ id: SCHEMA_ID, key: 'intake', name: 'Intake' }]);
    const row = await createSchema(TENANT, { key: 'intake', name: 'Intake' }, ACTOR);
    expect(row.key).toBe('intake');
  });

  it('rejects invalid key', async () => {
    await expect(
      createSchema(TENANT, { key: 'Bad-Key', name: 'X' }, ACTOR),
    ).rejects.toThrow();
  });

  it('throws FORBIDDEN when disabled', async () => {
    mockGetTierConfig.mockResolvedValue({ enabled: false, tiers: {}, limits: {} });
    await expect(
      createSchema(TENANT, { key: 'intake', name: 'Intake' }, ACTOR),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects invalid tenant id', async () => {
    await expect(
      createSchema('bad', { key: 'intake', name: 'Intake' }, ACTOR),
    ).rejects.toMatchObject({ message: expect.stringMatching(/invalid tenant/i) });
  });
});

describe('getSchema', () => {
  it('returns schema', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([{ id: SCHEMA_ID, key: 'intake' }]);
    const row = await getSchema(TENANT, SCHEMA_ID);
    expect(row.id).toBe(SCHEMA_ID);
  });

  it('throws NOT_FOUND', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([]);
    await expect(getSchema(TENANT, SCHEMA_ID)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('addField', () => {
  it('adds a field', async () => {
    mockWithTenantQuery
      .mockResolvedValueOnce([{ id: SCHEMA_ID }]) // getSchema
      .mockResolvedValueOnce([{ cnt: 0 }])
      .mockResolvedValueOnce([{ id: 'f1', field_key: 'email', field_type: 'email' }]);
    const row = await addField(TENANT, SCHEMA_ID, {
      field_key: 'email', label: 'Email', field_type: 'email', required: true,
    });
    expect(row.field_key).toBe('email');
  });

  it('requires fileFields tier for file type', async () => {
    mockGetTierConfig.mockResolvedValue(defaultTier({ tiers: { fileFields: false } }));
    await expect(
      addField(TENANT, SCHEMA_ID, {
        field_key: 'doc', label: 'Doc', field_type: 'file',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('listFields', () => {
  it('lists fields ordered', async () => {
    mockWithTenantQuery
      .mockResolvedValueOnce([{ id: SCHEMA_ID }])
      .mockResolvedValueOnce([{ field_key: 'a' }, { field_key: 'b' }]);
    const rows = await listFields(TENANT, SCHEMA_ID);
    expect(rows).toHaveLength(2);
  });
});

describe('publishSchema', () => {
  it('publishes and bumps version', async () => {
    mockWithTenantQuery
      .mockResolvedValueOnce([{ id: SCHEMA_ID, version: 1, status: 'draft' }]) // getSchema
      .mockResolvedValueOnce([{ id: SCHEMA_ID }]) // getSchema inside listFields
      .mockResolvedValueOnce([{ field_key: 'email' }]) // fields
      .mockResolvedValueOnce([]) // insert version
      .mockResolvedValueOnce([{ id: SCHEMA_ID, status: 'published', version: 1 }]);
    const row = await publishSchema(TENANT, SCHEMA_ID, ACTOR);
    expect(row.status).toBe('published');
  });

  it('throws NOT_FOUND for missing schema', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([]);
    await expect(publishSchema(TENANT, SCHEMA_ID, ACTOR)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
