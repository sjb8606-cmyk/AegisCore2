import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockClient = { query: vi.fn() };

vi.mock('@platform/tenancy', () => {
  async function withTenantTransaction(fn: (client: any) => Promise<any>, tenantId: string) {
    if (!tenantId) throw new Error('Tenant ID Mandatory');
    await mockClient.query('BEGIN');
    await mockClient.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
    const result = await fn(mockClient);
    await mockClient.query('COMMIT');
    return result;
  }
  return {
    withTenant: (tenantId: string, fn: (client: any) => Promise<any>) => withTenantTransaction(fn, tenantId),
    withTenantQuery: (sql: string, params: any[], tenantId: string) =>
      withTenantTransaction(async (client) => (await client.query(sql, params)).rows, tenantId),
  };
});

vi.mock('@platform/lot-traceability', () => ({
  LotTraceabilityService: { releaseLot: vi.fn() },
}));

vi.mock('@platform/recall-engine', () => ({
  RecallEngineService: { cascadeHold: vi.fn() },
}));

vi.mock('@platform/audit', () => ({
  emit: vi.fn(),
}));

import { HoldReleaseService } from '../index';
import { LotTraceabilityService } from '@platform/lot-traceability';
import { RecallEngineService } from '@platform/recall-engine';
import { emit as auditEmit } from '@platform/audit';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const LOT_ID = '33333333-3333-3333-3333-333333333333';
const CHILD_ID = '44444444-4444-4444-4444-444444444444';
const INVESTIGATION_ID = '55555555-5555-5555-5555-555555555555';

beforeEach(() => {
  vi.clearAllMocks();
  mockClient.query.mockReset();
});

describe('HoldReleaseService.openInvestigation', () => {
  it('cascades a real hold and records exactly which lots were held', async () => {
    (RecallEngineService.cascadeHold as any).mockResolvedValue({
      sourceLotId: LOT_ID,
      totalTargeted: 2,
      heldCount: 2,
      failedCount: 0,
      results: [
        { lotId: LOT_ID, status: 'held' },
        { lotId: CHILD_ID, status: 'held' },
      ],
    });
    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        rows: [{ id: INVESTIGATION_ID, lot_id: LOT_ID, status: 'open', held_lot_ids: [LOT_ID, CHILD_ID] }],
      })
      .mockResolvedValueOnce(undefined);

    const { investigation, holdReport } = await HoldReleaseService.openInvestigation(TENANT_ID, USER_ID, LOT_ID, {
      reasonCategory: 'contamination',
      reasonDetail: 'Suspected listeria in raw intake',
    });

    expect(RecallEngineService.cascadeHold).toHaveBeenCalledWith(
      TENANT_ID,
      USER_ID,
      LOT_ID,
      expect.objectContaining({ reason: expect.stringContaining('contamination') }),
    );
    expect(investigation.status).toBe('open');
    expect(holdReport.heldCount).toBe(2);

    const insertCall = mockClient.query.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO hold_investigations'),
    );
    expect(JSON.parse(insertCall[1][4])).toEqual([LOT_ID, CHILD_ID]);
  });

  it('rejects an empty reasonDetail before calling cascadeHold at all', async () => {
    await expect(
      HoldReleaseService.openInvestigation(TENANT_ID, USER_ID, LOT_ID, {
        reasonCategory: 'contamination',
        reasonDetail: '',
      }),
    ).rejects.toThrow();

    expect(RecallEngineService.cascadeHold).not.toHaveBeenCalled();
  });
});

describe('HoldReleaseService.resolveInvestigation — release', () => {
  it('releases every lot that was held when the investigation opened', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        rows: [{ id: INVESTIGATION_ID, status: 'open', held_lot_ids: [LOT_ID, CHILD_ID] }],
      })
      .mockResolvedValueOnce(undefined);

    (LotTraceabilityService.releaseLot as any).mockImplementation((_t: string, _u: string, lotId: string) =>
      Promise.resolve({ id: lotId, status: 'released' }),
    );

    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ id: INVESTIGATION_ID, status: 'resolved', resolution: 'release' }] })
      .mockResolvedValueOnce(undefined);

    const { investigation, releaseResults } = await HoldReleaseService.resolveInvestigation(
      TENANT_ID,
      USER_ID,
      INVESTIGATION_ID,
      { resolution: 'release', findings: 'Lab results came back negative for contamination' },
    );

    expect(investigation.status).toBe('resolved');
    expect(LotTraceabilityService.releaseLot).toHaveBeenCalledTimes(2);
    expect(releaseResults).toEqual([
      { lotId: LOT_ID, status: 'released' },
      { lotId: CHILD_ID, status: 'released' },
    ]);
  });
});

describe('HoldReleaseService.resolveInvestigation — destroy/rework', () => {
  it('does NOT release any lots on a "destroy" decision — this module does not model physical destruction', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        rows: [{ id: INVESTIGATION_ID, status: 'open', held_lot_ids: [LOT_ID, CHILD_ID] }],
      })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ id: INVESTIGATION_ID, status: 'resolved', resolution: 'destroy' }] })
      .mockResolvedValueOnce(undefined);

    const { investigation, releaseResults } = await HoldReleaseService.resolveInvestigation(
      TENANT_ID,
      USER_ID,
      INVESTIGATION_ID,
      { resolution: 'destroy', findings: 'Confirmed contamination, product destroyed on site' },
    );

    expect(investigation.resolution).toBe('destroy');
    expect(releaseResults).toEqual([]);
    expect(LotTraceabilityService.releaseLot).not.toHaveBeenCalled();
  });
});

describe('HoldReleaseService.resolveInvestigation — already resolved', () => {
  it('throws CONFLICT and does not touch any lots when the investigation is already resolved', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ id: INVESTIGATION_ID, status: 'resolved', held_lot_ids: [LOT_ID] }] })
      .mockResolvedValueOnce(undefined);

    await expect(
      HoldReleaseService.resolveInvestigation(TENANT_ID, USER_ID, INVESTIGATION_ID, {
        resolution: 'release',
        findings: 'trying to re-resolve',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    expect(LotTraceabilityService.releaseLot).not.toHaveBeenCalled();
  });
});

describe('HoldReleaseService.getInvestigation', () => {
  it('throws NOT_FOUND for a nonexistent investigation', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce(undefined);

    await expect(HoldReleaseService.getInvestigation(TENANT_ID, INVESTIGATION_ID)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('HoldReleaseService.listOpenInvestigations', () => {
  it('returns only open investigations', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ id: INVESTIGATION_ID, status: 'open' }] })
      .mockResolvedValueOnce(undefined);

    const list = await HoldReleaseService.listOpenInvestigations(TENANT_ID);
    expect(list).toEqual([{ id: INVESTIGATION_ID, status: 'open' }]);
  });
});

describe('Golden Template migration — real audit trail, genuinely missing before this fix', () => {
  it('openInvestigation now emits a real audit event with a VALID action value from the real enum', async () => {
    (RecallEngineService.cascadeHold as any).mockResolvedValue({
      results: [{ lotId: LOT_ID, status: 'held' }],
    });
    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ id: INVESTIGATION_ID, lot_id: LOT_ID, held_lot_ids: [LOT_ID] }] })
      .mockResolvedValueOnce(undefined);

    await HoldReleaseService.openInvestigation(TENANT_ID, USER_ID, LOT_ID, {
      reasonCategory: 'contamination',
      reasonDetail: 'test',
    });

    expect(auditEmit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'compliance.investigation_opened', tenantId: TENANT_ID }),
    );
  });

  it('resolveInvestigation now emits a real audit event with a VALID action value', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ id: INVESTIGATION_ID, status: 'open', held_lot_ids: [] }] })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ id: INVESTIGATION_ID, status: 'resolved' }] })
      .mockResolvedValueOnce(undefined);

    await HoldReleaseService.resolveInvestigation(TENANT_ID, USER_ID, INVESTIGATION_ID, {
      resolution: 'destroy',
      findings: 'test findings',
    });

    expect(auditEmit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'compliance.investigation_resolved', tenantId: TENANT_ID }),
    );
  });
});
