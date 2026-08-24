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
      lateCancelHours: 24,
      defaultDepositCents: 2500,
      strikesBeforeBlock: 3,
      autoCaptureOnNoShow: true,
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
  createDepositAppointment,
  cancelAppointment,
  markNoShow,
  completeAppointment,
  getClientStrikeState,
  __resetNoShowDepositStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';
const clientId = '00000000-0000-4000-8000-0000000000cc';

describe('no-show-deposit-policy', () => {
  beforeEach(() => {
    __resetNoShowDepositStore();
    vi.clearAllMocks();
  });

  it('releases deposit on on-time cancel', async () => {
    const scheduled = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
    const appt = await createDepositAppointment(tenantId, actorId, {
      clientId,
      scheduledAt: scheduled,
      depositCents: 2500,
    });
    expect(appt.depositStatus).toBe('held');
    const cancelled = await cancelAppointment(tenantId, actorId, appt.id);
    expect(cancelled.outcome).toBe('cancelled_on_time');
    expect(cancelled.depositStatus).toBe('released');
  });

  it('forfeits deposit on no-show and increments strikes', async () => {
    const scheduled = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
    const appt = await createDepositAppointment(tenantId, actorId, {
      clientId,
      scheduledAt: scheduled,
    });
    const ns = await markNoShow(tenantId, actorId, appt.id);
    expect(ns.outcome).toBe('no_show');
    expect(ns.depositStatus).toBe('forfeited');
    const state = await getClientStrikeState(tenantId, actorId, clientId);
    expect(state.strikes).toBe(1);
  });

  it('captures deposit on completed visit', async () => {
    const appt = await createDepositAppointment(tenantId, actorId, {
      clientId,
      scheduledAt: new Date(Date.now() + 86400000).toISOString(),
    });
    const done = await completeAppointment(tenantId, actorId, appt.id);
    expect(done.outcome).toBe('completed');
    expect(done.depositStatus).toBe('captured');
  });
});
