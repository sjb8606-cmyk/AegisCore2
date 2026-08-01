import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../tenancy/src/index', () => ({
  withTenantQuery: vi.fn(),
}));
vi.mock('../../../../utils/src/index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../utils/src/index')>();
  return { ...actual, loadConfig: vi.fn() };
});

import { ComplianceReporterService, ErrorCode } from '../index';
import { withTenantQuery } from '../../../../tenancy/src/index';
import { loadConfig } from '../../../../utils/src/index';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const REPORT_ID = '88888888-8888-8888-8888-888888888888';

const validFilters = {
  fromDate: '2026-07-01T00:00:00.000Z',
  toDate: '2026-07-31T23:59:59.999Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  (loadConfig as any).mockReturnValue({ enabled: true });
});

describe('ComplianceReporterService.generateCatchReport', () => {
  it('computes real totals from the real grouped query result', async () => {
    (withTenantQuery as any)
      .mockResolvedValueOnce([
        {
          species_id: 'sp-1', common_name: 'Atlantic Salmon', shipment_count: 3,
          total_weight_kg: 1500, vessels: ['F/V Northern Tide'], catch_zones: ['NAFO-4X'],
        },
        {
          species_id: 'sp-2', common_name: 'Haddock', shipment_count: 2,
          total_weight_kg: 800, vessels: ['F/V Sea Runner'], catch_zones: ['NAFO-4W'],
        },
      ])
      .mockResolvedValueOnce([{ id: REPORT_ID }]);

    await ComplianceReporterService.generateCatchReport(TENANT_ID, USER_ID, validFilters);

    const insertCall = (withTenantQuery as any).mock.calls[1];
    const summary = JSON.parse(insertCall[1][3]);
    expect(summary.total_weight_kg).toBe(2300);
    expect(summary.total_shipments).toBe(5);
    expect(summary.species_breakdown).toHaveLength(2);
  });

  it('returns an honest empty report when there are no shipments in range (not an error)', async () => {
    (withTenantQuery as any)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: REPORT_ID }]);

    await ComplianceReporterService.generateCatchReport(TENANT_ID, USER_ID, validFilters);

    const insertCall = (withTenantQuery as any).mock.calls[1];
    const summary = JSON.parse(insertCall[1][3]);
    expect(summary.total_weight_kg).toBe(0);
    expect(summary.species_breakdown).toEqual([]);
  });

  it('throws a validation error when fromDate is after toDate', async () => {
    await expect(
      ComplianceReporterService.generateCatchReport(TENANT_ID, USER_ID, {
        fromDate: '2026-07-31T00:00:00.000Z',
        toDate: '2026-07-01T00:00:00.000Z',
      })
    ).rejects.toThrow();
  });

  it('throws BAD_REQUEST for an invalid userId', async () => {
    await expect(
      ComplianceReporterService.generateCatchReport(TENANT_ID, 'not-a-uuid', validFilters)
    ).rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST });
  });
});

describe('ComplianceReporterService.getReport', () => {
  it('throws NOT_FOUND for a nonexistent report', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    await expect(
      ComplianceReporterService.getReport(TENANT_ID, REPORT_ID)
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });
});

describe('ComplianceReporterService.listReports', () => {
  it('returns the real list', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: REPORT_ID }]);

    const result = await ComplianceReporterService.listReports(TENANT_ID);
    expect(result).toHaveLength(1);
  });
});
