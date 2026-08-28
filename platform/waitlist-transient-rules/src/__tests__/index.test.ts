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
      defaultDepositCents: 50000,
      offerTtlHours: 48,
      seasonalPriorityBoost: 10,
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
  joinWaitlist,
  offerNextBerth,
  acceptOffer,
  declineOffer,
  getWaitlist,
  __resetWaitlistTransientStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';

describe('waitlist-transient-rules', () => {
  beforeEach(() => {
    __resetWaitlistTransientStore();
    vi.clearAllMocks();
  });

  it('queues vessels and prioritizes seasonal on offer', async () => {
    await joinWaitlist(tenantId, actorId, {
      vesselId: 'v-transient',
      requestType: 'transient',
    });
    await joinWaitlist(tenantId, actorId, {
      vesselId: 'v-seasonal',
      requestType: 'seasonal',
    });
    const offered = await offerNextBerth(tenantId, actorId, 'slip-1');
    expect(offered?.vesselId).toBe('v-seasonal');
    expect(offered?.status).toBe('offered');
  });

  it('accepts offer', async () => {
    await joinWaitlist(tenantId, actorId, {
      vesselId: 'v1',
      requestType: 'transient',
    });
    const offered = await offerNextBerth(tenantId, actorId);
    const accepted = await acceptOffer(tenantId, actorId, offered!.id);
    expect(accepted.status).toBe('accepted');
  });

  it('declines and releases deposit flag', async () => {
    const entry = await joinWaitlist(tenantId, actorId, {
      vesselId: 'v2',
      requestType: 'seasonal',
      holdDeposit: true,
    });
    expect(entry.depositHeld).toBe(true);
    const declined = await declineOffer(tenantId, actorId, entry.id);
    expect(declined.status).toBe('cancelled');
    expect(declined.depositHeld).toBe(false);
    const list = await getWaitlist(tenantId, actorId);
    expect(list.find((e) => e.id === entry.id)).toBeUndefined();
  });
});
