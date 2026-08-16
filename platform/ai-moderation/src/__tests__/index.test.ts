import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@platform/tenancy', () => ({
  withTenantQuery: vi.fn(),
}));

import { moderateContent } from '../index';
import { withTenantQuery } from '@platform/tenancy';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

beforeEach(() => {
  vi.clearAllMocks();
  (withTenantQuery as any).mockImplementation((sql: string) => {
    if (sql.includes('SELECT COUNT')) return Promise.resolve([{ count: '0' }]);
    return Promise.resolve([{ id: 'moderation-1', tenant_id: TENANT_ID }]);
  });
});

describe('ai-moderation — real PII filtering, confirmed worst gap fixed', () => {
  it('redacts an SSN — the old local version ONLY caught email, this was a real, confirmed live gap', async () => {
    await moderateContent(TENANT_ID, USER_ID, {
      contentText: 'My SSN is 123-45-6789, please help.',
    });

    const insertCall = (withTenantQuery as any).mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO moderation_items'),
    );
    const storedText = insertCall[1][4];
    expect(storedText).toContain('[SSN REDACTED]');
    expect(storedText).not.toContain('123-45-6789');
  });

  it('redacts a phone number too — also previously missed entirely', async () => {
    await moderateContent(TENANT_ID, USER_ID, {
      contentText: 'Reach me at 555-987-6543.',
    });

    const insertCall = (withTenantQuery as any).mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO moderation_items'),
    );
    const storedText = insertCall[1][4];
    expect(storedText).toContain('[PHONE REDACTED]');
  });

  it('still redacts email too — the one category the old version did catch', async () => {
    await moderateContent(TENANT_ID, USER_ID, {
      contentText: 'Contact me at jane@example.com.',
    });

    const insertCall = (withTenantQuery as any).mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO moderation_items'),
    );
    const storedText = insertCall[1][4];
    expect(storedText).toContain('[EMAIL REDACTED]');
  });
});
