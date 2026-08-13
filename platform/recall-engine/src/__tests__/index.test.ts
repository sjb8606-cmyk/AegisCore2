import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@platform/lot-traceability', () => ({
  LotTraceabilityService: {
    getLot: vi.fn(),
    traceUpstream: vi.fn(),
    traceDownstream: vi.fn(),
    holdLot: vi.fn(),
  },
}));

import { RecallEngineService } from '../index';
import { LotTraceabilityService } from '@platform/lot-traceability';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const LOT_ID = '33333333-3333-3333-3333-333333333333';
const CHILD_A = '44444444-4444-4444-4444-444444444444';
const CHILD_B = '55555555-5555-5555-5555-555555555555';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('RecallEngineService.generateRecallReport', () => {
  it('combines the lot itself with its real upstream and downstream trace', async () => {
    (LotTraceabilityService.getLot as any).mockResolvedValue({ id: LOT_ID, lot_code: 'LOT-ABC' });
    (LotTraceabilityService.traceUpstream as any).mockResolvedValue([{ id: 'vessel-lot', depth: 1 }]);
    (LotTraceabilityService.traceDownstream as any).mockResolvedValue([
      { id: CHILD_A, depth: 1 },
      { id: CHILD_B, depth: 1 },
    ]);

    const report = await RecallEngineService.generateRecallReport(TENANT_ID, LOT_ID);

    expect(report.lot.id).toBe(LOT_ID);
    expect(report.upstreamCount).toBe(1);
    expect(report.downstreamCount).toBe(2);
    expect(report.downstream.map((d: any) => d.id)).toEqual([CHILD_A, CHILD_B]);
    expect(report.generatedAt).toBeTruthy();
  });

  it('propagates NOT_FOUND when the lot itself does not exist', async () => {
    (LotTraceabilityService.getLot as any).mockRejectedValue(
      Object.assign(new Error('not found'), { code: 'NOT_FOUND' }),
    );
    (LotTraceabilityService.traceUpstream as any).mockResolvedValue([]);
    (LotTraceabilityService.traceDownstream as any).mockResolvedValue([]);

    await expect(RecallEngineService.generateRecallReport(TENANT_ID, LOT_ID)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('RecallEngineService.cascadeHold', () => {
  it('holds the source lot and every downstream lot', async () => {
    (LotTraceabilityService.traceDownstream as any).mockResolvedValue([
      { id: CHILD_A, depth: 1 },
      { id: CHILD_B, depth: 2 },
    ]);
    (LotTraceabilityService.holdLot as any).mockImplementation((_t: string, _u: string, lotId: string) =>
      Promise.resolve({ id: lotId, status: 'held' }),
    );

    const report = await RecallEngineService.cascadeHold(TENANT_ID, USER_ID, LOT_ID, {
      reason: 'Temperature excursion detected upstream',
    });

    expect(report.totalTargeted).toBe(3);
    expect(report.heldCount).toBe(3);
    expect(report.failedCount).toBe(0);
    expect(LotTraceabilityService.holdLot).toHaveBeenCalledWith(TENANT_ID, USER_ID, LOT_ID, {
      reason: 'Temperature excursion detected upstream',
    });
    expect(LotTraceabilityService.holdLot).toHaveBeenCalledWith(TENANT_ID, USER_ID, CHILD_A, {
      reason: 'Temperature excursion detected upstream',
    });
    expect(LotTraceabilityService.holdLot).toHaveBeenCalledWith(TENANT_ID, USER_ID, CHILD_B, {
      reason: 'Temperature excursion detected upstream',
    });
  });

  it('dedupes a downstream lot reachable via two different paths, instead of holding it twice', async () => {
    (LotTraceabilityService.traceDownstream as any).mockResolvedValue([
      { id: CHILD_A, depth: 1 },
      { id: CHILD_A, depth: 2 },
    ]);
    (LotTraceabilityService.holdLot as any).mockImplementation((_t: string, _u: string, lotId: string) =>
      Promise.resolve({ id: lotId, status: 'held' }),
    );

    const report = await RecallEngineService.cascadeHold(TENANT_ID, USER_ID, LOT_ID, {
      reason: 'duplicate path test',
    });

    expect(report.totalTargeted).toBe(2);
    expect(LotTraceabilityService.holdLot).toHaveBeenCalledTimes(2);
  });

  it('continues holding remaining lots even when one hold fails, and reports it', async () => {
    (LotTraceabilityService.traceDownstream as any).mockResolvedValue([
      { id: CHILD_A, depth: 1 },
      { id: CHILD_B, depth: 1 },
    ]);
    (LotTraceabilityService.holdLot as any).mockImplementation((_t: string, _u: string, lotId: string) => {
      if (lotId === CHILD_A) {
        return Promise.reject(Object.assign(new Error('Lot is already on hold'), { code: 'CONFLICT' }));
      }
      return Promise.resolve({ id: lotId, status: 'held' });
    });

    const report = await RecallEngineService.cascadeHold(TENANT_ID, USER_ID, LOT_ID, {
      reason: 'partial failure test',
    });

    expect(report.totalTargeted).toBe(3);
    expect(report.heldCount).toBe(2);
    expect(report.failedCount).toBe(1);
    const failedEntry = report.results.find((r) => r.lotId === CHILD_A);
    expect(failedEntry?.status).toBe('failed');
    expect(failedEntry?.error).toContain('already on hold');
    const childBEntry = report.results.find((r) => r.lotId === CHILD_B);
    expect(childBEntry?.status).toBe('held');
  });

  it('rejects an empty reason before calling any downstream trace or hold', async () => {
    await expect(
      RecallEngineService.cascadeHold(TENANT_ID, USER_ID, LOT_ID, { reason: '' }),
    ).rejects.toThrow();

    expect(LotTraceabilityService.traceDownstream).not.toHaveBeenCalled();
    expect(LotTraceabilityService.holdLot).not.toHaveBeenCalled();
  });
});
