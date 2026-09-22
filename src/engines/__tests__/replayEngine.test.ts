import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetReceipt = vi.fn();
const mockRecomputeHash = vi.fn();
const mockComputeDecision = vi.fn();
const mockBuildDiff = vi.fn();
const mockWriteChange = vi.fn();
const mockTriggerAlert = vi.fn();
const mockWithTenant = vi.fn(async (_t: string, fn: (c: unknown) => unknown) => fn({}));

vi.mock('../../db/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));
vi.mock('../../db/client', () => ({
  withTenant: (...a: unknown[]) => mockWithTenant(...a),
}));
vi.mock('../receiptEngine', () => ({
  getReceiptById: (...a: unknown[]) => mockGetReceipt(...a),
  recomputeHash: (...a: unknown[]) => mockRecomputeHash(...a),
  computeDecision: (...a: unknown[]) => mockComputeDecision(...a),
}));
vi.mock('../changeLog', () => ({
  buildDiff: (...a: unknown[]) => mockBuildDiff(...a),
  writeChangeEntry: (...a: unknown[]) => mockWriteChange(...a),
}));
vi.mock('../alertEngine', () => ({
  triggerAlert: (...a: unknown[]) => mockTriggerAlert(...a),
}));

import { replayReceipt } from '../replayEngine';

const TENANT = '11111111-1111-1111-1111-111111111111';
const RID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const actor = { type: 'user' as const, id: 'u1' };

const baseReceipt = {
  receipt_id: RID,
  tenant_id: TENANT,
  event_type: 'new_receipt' as const,
  input: { x: 1 },
  output: { decision: 'allow' },
  rules_version: '1.0.0',
  rules_hash: 'b'.repeat(64),
  hash: 'd'.repeat(64),
  previous_hash: '0'.repeat(64),
  timestamp: new Date().toISOString(),
  replayable: true as const,
  actor,
  context: { source: 'api' as const, trigger: 'manual' as const },
};

describe('replayEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildDiff.mockReturnValue([]);
    mockTriggerAlert.mockResolvedValue({});
    mockWriteChange.mockResolvedValue({});
  });

  it('404 when receipt missing', async () => {
    mockGetReceipt.mockResolvedValueOnce(null);
    await expect(replayReceipt({ tenantId: TENANT, receiptId: RID, actor })).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('422 when not replayable', async () => {
    mockGetReceipt.mockResolvedValueOnce({ ...baseReceipt, replayable: false });
    await expect(replayReceipt({ tenantId: TENANT, receiptId: RID, actor })).rejects.toMatchObject({
      statusCode: 422,
    });
  });

  it('match path: event_type replay_match, no changeLog write', async () => {
    mockGetReceipt.mockResolvedValueOnce(baseReceipt);
    mockRecomputeHash.mockReturnValueOnce(baseReceipt.hash);
    mockComputeDecision.mockResolvedValueOnce({
      decision: 'allow',
      output: baseReceipt.output,
    });
    mockBuildDiff.mockReturnValueOnce([]);

    const result = await replayReceipt({ tenantId: TENANT, receiptId: RID, actor });
    expect(result.match).toBe(true);
    expect(result.event_type).toBe('replay_match');
    expect(mockTriggerAlert).toHaveBeenCalled();
    expect(mockWriteChange).not.toHaveBeenCalled();
  });

  it('mismatch path: writes change entry and alerts', async () => {
    mockGetReceipt.mockResolvedValueOnce(baseReceipt);
    mockRecomputeHash.mockReturnValueOnce('e'.repeat(64));
    mockComputeDecision.mockResolvedValueOnce({
      decision: 'deny',
      output: { decision: 'deny' },
    });
    mockBuildDiff.mockReturnValueOnce([
      { field: 'decision', before: 'allow', after: 'deny' },
    ]);

    const result = await replayReceipt({ tenantId: TENANT, receiptId: RID, actor });
    expect(result.match).toBe(false);
    expect(result.event_type).toBe('replay_mismatch');
    expect(result.delta).toHaveLength(1);
    expect(mockWriteChange).toHaveBeenCalled();
    expect(mockTriggerAlert).toHaveBeenCalled();
  });
});
