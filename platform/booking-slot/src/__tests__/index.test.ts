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
      serviceTypes: [
        { type: 'consultation', defaultDurationMinutes: 30 },
      ],
      cancellationWindowMinutes: 60,
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
  createSlot,
  listAvailable,
  bookSlot,
  cancelSlot,
  __resetBookingSlotStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';

describe('booking-slot', () => {
  beforeEach(() => {
    __resetBookingSlotStore();
    vi.clearAllMocks();
  });

  it('creates, lists, books a slot', async () => {
    // far-future so cancel window is fine
    const start = new Date(Date.now() + 7 * 24 * 3600_000).toISOString();
    const slot = await createSlot(tenantId, actorId, {
      serviceType: 'consultation',
      startTime: start,
    });
    expect(slot.status).toBe('available');
    const available = await listAvailable(tenantId, {
      serviceType: 'consultation',
    });
    expect(available.length).toBe(1);
    const booked = await bookSlot(tenantId, actorId, slot.id, 'user-9');
    expect(booked.status).toBe('booked');
    expect(booked.bookedBy).toBe('user-9');
  });

  it('blocks double-book and overlap', async () => {
    const start = new Date(Date.now() + 10 * 24 * 3600_000).toISOString();
    const slot = await createSlot(tenantId, actorId, {
      serviceType: 'consultation',
      startTime: start,
    });
    await bookSlot(tenantId, actorId, slot.id, 'u1');
    await expect(
      bookSlot(tenantId, actorId, slot.id, 'u2'),
    ).rejects.toThrow(/not available/i);

    await expect(
      createSlot(tenantId, actorId, {
        serviceType: 'consultation',
        startTime: start,
      }),
    ).rejects.toThrow(/overlap/i);
  });

  it('cancels booked slot outside window', async () => {
    const start = new Date(Date.now() + 7 * 24 * 3600_000).toISOString();
    const slot = await createSlot(tenantId, actorId, {
      serviceType: 'consultation',
      startTime: start,
    });
    await bookSlot(tenantId, actorId, slot.id, 'u1');
    const cancelled = await cancelSlot(tenantId, actorId, slot.id, 'u1');
    expect(cancelled.status).toBe('cancelled');
  });
});
