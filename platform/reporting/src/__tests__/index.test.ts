import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

vi.mock('../../../tenancy/src/index', () => ({
  withTenantQuery: vi.fn(),
}));

import { createReport, runReport, getExecutiveDashboard, ErrorCode } from '../index';
import { withTenantQuery } from '../../../tenancy/src/index';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const REPORT_ID = '33333333-3333-3333-3333-333333333333';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createReport', () => {
  it('creates a report definition', async () => {
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ count: '2' }])
      .mockResolvedValueOnce([{ id: REPORT_ID, name: 'Catch Summary' }]);

    const result = await createReport(TENANT_ID, USER_ID, { name: 'Catch Summary', type: 'catch_summary' });
    expect(result.id).toBe(REPORT_ID);
  });
});

describe('runReport', () => {
  it('throws NOT_FOUND when the report definition does not exist', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    await expect(runReport(TENANT_ID, REPORT_ID, USER_ID)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
  });

  it('throws NOT_IMPLEMENTED for a report type with no real handler, and marks the run failed (never returns fake data)', async () => {
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ id: REPORT_ID, type: 'catch_summary', config: {} }])
      .mockResolvedValueOnce([{ id: 'run-1' }])
      .mockResolvedValueOnce([]);

    await expect(runReport(TENANT_ID, REPORT_ID, USER_ID)).rejects.toMatchObject({
      code: ErrorCode.NOT_IMPLEMENTED,
    });

    const updateCall = (withTenantQuery as any).mock.calls.find((call: any[]) =>
      call[0].includes("status = 'failed'")
    );
    expect(updateCall).toBeDefined();
  });
});

describe('getExecutiveDashboard', () => {
  it('throws NOT_IMPLEMENTED rather than returning fabricated KPIs', async () => {
    await expect(getExecutiveDashboard(TENANT_ID)).rejects.toMatchObject({
      code: ErrorCode.NOT_IMPLEMENTED,
    });
  });
});

describe('regression guard — the old fabricated numbers are gone from the source', () => {
  it('the source file no longer contains the old hardcoded fake metrics', () => {
    const sourcePath = path.resolve(__dirname, '../index.ts');
    const source = fs.readFileSync(sourcePath, 'utf8');

    expect(source).not.toContain('Aggregate Transactions');
    expect(source).not.toContain('Active Operational Leases');
    expect(source).not.toContain('Total Invoiced Revenue');
    expect(source).not.toContain('activeTenants: 14');
    expect(source).not.toContain('aggregateGrosProfitCents');
  });
});
