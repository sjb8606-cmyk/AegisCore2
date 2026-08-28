import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@platform/audit', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@platform/metering', () => ({
  recordUsage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@platform/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platform/utils')>();
  return {
    ...actual,
    loadConfig: vi.fn().mockReturnValue({
      enabled: true,
      evidenceWindowHours: 72,
      reasonCodes: [
        'item_not_received',
        'not_as_described',
        'damaged',
        'wrong_item',
        'other',
      ],
    }),
  };
});
vi.mock('@platform/observability', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  openDispute,
  submitEvidence,
  resolveDispute,
  listOpenDisputes,
  __resetDisputeResolutionStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';
const orderId = '00000000-0000-4000-8000-0000000000ee';

describe('dispute-resolution', () => {
  beforeEach(() => {
    __resetDisputeResolutionStore();
    vi.clearAllMocks();
  });

  it('opens dispute and collects evidence', async () => {
    const d = await openDispute(tenantId, actorId, {
      orderId,
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
      reasonCode: 'not_as_described',
      amountCents: 5000,
    });
    expect(d.status).toBe('open');
    const withEv = await submitEvidence(tenantId, actorId, d.id, {
      party: 'buyer',
      note: 'Photos attached',
      attachmentRef: 's3://ev/1',
    });
    expect(withEv.status).toBe('evidence');
    expect(withEv.evidence).toHaveLength(1);
  });

  it('resolves in favor of buyer', async () => {
    const d = await openDispute(tenantId, actorId, {
      orderId,
      buyerId: 'b',
      sellerId: 's',
      reasonCode: 'damaged',
      amountCents: 2000,
    });
    const resolved = await resolveDispute(tenantId, actorId, d.id, {
      outcome: 'buyer',
      note: 'Seller failed to ship intact',
    });
    expect(resolved.status).toBe('resolved_buyer');
    const open = await listOpenDisputes(tenantId, actorId);
    expect(open.find((x) => x.id === d.id)).toBeUndefined();
  });

  it('blocks duplicate open dispute on same order', async () => {
    await openDispute(tenantId, actorId, {
      orderId,
      buyerId: 'b',
      sellerId: 's',
      reasonCode: 'other',
      amountCents: 100,
    });
    await expect(
      openDispute(tenantId, actorId, {
        orderId,
        buyerId: 'b',
        sellerId: 's',
        reasonCode: 'other',
        amountCents: 100,
      }),
    ).rejects.toThrow(/already exists/i);
  });
});
