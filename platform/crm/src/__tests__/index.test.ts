import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@platform/tenancy', () => ({
  withTenantQuery: vi.fn(),
}));

vi.mock('@platform/audit', () => ({
  emit: vi.fn(),
}));

vi.mock('@platform/metering', () => ({
  recordUsage: vi.fn(),
}));

vi.mock('@platform/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platform/utils')>();
  return { ...actual, loadConfig: vi.fn() };
});

import { createContact } from '../index';
import { withTenantQuery } from '@platform/tenancy';
import { loadConfig } from '@platform/utils';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
  (loadConfig as any).mockReturnValue({ enabled: true, limits: { contacts: 100, deals: 100 } });
  (withTenantQuery as any).mockImplementation((sql: string) => {
    if (sql.includes('SELECT COUNT')) return Promise.resolve([{ count: 0 }]);
    return Promise.resolve([{ id: 'contact-1', type: 'person' }]);
  });
});

describe('crm.createContact — matches the real V121 table schema, not the dropped V25 one', () => {
  it('supplies "type" on every insert — the real table requires it (NOT NULL), the old code never sent it', async () => {
    await createContact(TENANT_ID, { firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' });

    const insertCall = (withTenantQuery as any).mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO contacts'),
    );
    expect(insertCall[0]).toContain('type');
    expect(insertCall[1]).toContain('person');
  });

  it('defaults to "person" when no type is specified', async () => {
    await createContact(TENANT_ID, { firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' });

    const insertCall = (withTenantQuery as any).mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO contacts'),
    );
    expect(insertCall[1][2]).toBe('person');
  });

  it('honors "organization" when explicitly specified — the only other value the real CHECK constraint allows', async () => {
    await createContact(TENANT_ID, { type: 'organization', firstName: 'Acme', lastName: 'Corp', email: 'info@acme.com' });

    const insertCall = (withTenantQuery as any).mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO contacts'),
    );
    expect(insertCall[1][2]).toBe('organization');
  });
});
