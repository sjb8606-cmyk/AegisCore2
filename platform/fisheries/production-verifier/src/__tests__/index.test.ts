import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../audit-log/src/index', () => ({
  ingestEvent: vi.fn(),
}));
vi.mock('../../../../verifier/src/index', () => ({
  runIntegrityCheck: vi.fn(),
}));
vi.mock('../../../../tenancy/src/index', () => ({
  withTenantQuery: vi.fn(),
}));

import { ProductionVerifierService, ErrorCode } from '../index';
import { ingestEvent } from '../../../../audit-log/src/index';
import { runIntegrityCheck } from '../../../../verifier/src/index';
import { withTenantQuery } from '../../../../tenancy/src/index';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const BATCH_ID = '66666666-6666-6666-6666-666666666666';
const YIELD_RECORD_ID = '77777777-7777-7777-7777-777777777777';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ProductionVerifierService.recordBatchCompletion', () => {
  it('records a real hash-chained event with real batch data', async () => {
    (ingestEvent as any).mockResolvedValue({ sequence: 5, event_hash: 'abc123' });

    const batch = {
      id: BATCH_ID, species_id: 'sp-1', raw_input_weight_kg: 800,
      finished_weight_kg: 500, completed_at: '2026-07-15T14:00:00.000Z',
    };

    await ProductionVerifierService.recordBatchCompletion(TENANT_ID, USER_ID, batch);

    expect(ingestEvent).toHaveBeenCalledWith(TENANT_ID, expect.objectContaining({
      event_type: 'fisheries.batch_completed',
      resource_type: 'processing_batch',
      resource_id: BATCH_ID,
      action: 'complete',
      outcome: 'success',
      after_state: expect.objectContaining({ finished_weight_kg: 500 }),
    }));
  });

  it('throws BAD_REQUEST for an invalid userId', async () => {
    await expect(
      ProductionVerifierService.recordBatchCompletion(TENANT_ID, 'not-a-uuid', { id: BATCH_ID })
    ).rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST });

    expect(ingestEvent).not.toHaveBeenCalled();
  });
});

describe('ProductionVerifierService.recordYieldComputation', () => {
  it('records a real hash-chained event with real yield data', async () => {
    (ingestEvent as any).mockResolvedValue({ sequence: 6, event_hash: 'def456' });

    const yieldRecord = {
      id: YIELD_RECORD_ID, batch_id: BATCH_ID,
      actual_yield_percent: 62.5, is_underperforming: false,
    };

    await ProductionVerifierService.recordYieldComputation(TENANT_ID, USER_ID, yieldRecord);

    expect(ingestEvent).toHaveBeenCalledWith(TENANT_ID, expect.objectContaining({
      event_type: 'fisheries.yield_computed',
      resource_id: YIELD_RECORD_ID,
      after_state: expect.objectContaining({ actual_yield_percent: 62.5 }),
    }));
  });
});

describe('ProductionVerifierService.verifyProductionIntegrity', () => {
  it('passes through a real SECURE verdict', async () => {
    (runIntegrityCheck as any).mockResolvedValue({ valid: true, checked: 42, verdict: 'SECURE' });

    const result = await ProductionVerifierService.verifyProductionIntegrity(TENANT_ID);
    expect(result.verdict).toBe('SECURE');
    expect(runIntegrityCheck).toHaveBeenCalledWith(TENANT_ID);
  });

  it('passes through a real COMPROMISED verdict — never fabricates a pass', async () => {
    (runIntegrityCheck as any).mockResolvedValue({ valid: false, checked: 0, verdict: 'COMPROMISED' });

    const result = await ProductionVerifierService.verifyProductionIntegrity(TENANT_ID);
    expect(result.verdict).toBe('COMPROMISED');
  });
});

describe('ProductionVerifierService.getVerificationHistory', () => {
  it('queries the real integrity_checks table ordered by verified_at', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: 'check-1', status: 'valid' }]);

    const result = await ProductionVerifierService.getVerificationHistory(TENANT_ID);
    expect(result).toHaveLength(1);

    const call = (withTenantQuery as any).mock.calls[0];
    expect(call[0]).toContain('ORDER BY verified_at DESC');
  });
});
