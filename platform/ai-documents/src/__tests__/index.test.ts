import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@platform/tenancy', () => ({
  withTenantQuery: vi.fn(),
}));

import { submitAnalysis } from '../index';
import { withTenantQuery } from '@platform/tenancy';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

beforeEach(() => {
  vi.clearAllMocks();
  (withTenantQuery as any).mockImplementation((sql: string) => {
    if (sql.includes('SELECT COUNT')) return Promise.resolve([{ count: '0' }]);
    return Promise.resolve([{ id: 'analysis-1', tenant_id: TENANT_ID }]);
  });
});

describe('ai-documents — real PII filtering, not the old local reimplementation', () => {
  it('redacts a phone number — the old local version only caught email, this one catches phone too', async () => {
    await submitAnalysis(TENANT_ID, USER_ID, {
      operation: 'summarize',
      raw_text: 'Call me at 555-123-4567 to discuss.',
    });

    const updateCall = (withTenantQuery as any).mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('UPDATE document_analyses'),
    );
    const resultJson = updateCall[1][0];
    expect(resultJson).toContain('[PHONE REDACTED]');
    expect(resultJson).not.toContain('555-123-4567');
  });

  it('redacts a credit card number — the old local version never caught this category at all', async () => {
    await submitAnalysis(TENANT_ID, USER_ID, {
      operation: 'extract',
      raw_text: 'Card on file: 4111111111111111.',
    });

    const updateCall = (withTenantQuery as any).mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('UPDATE document_analyses'),
    );
    const resultJson = updateCall[1][0];
    expect(resultJson).toContain('[CARD REDACTED]');
    expect(resultJson).not.toContain('4111111111111111');
  });
});
