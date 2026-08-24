import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@platform/audit', () => ({
  emit: vi.fn()
}));

vi.mock('@platform/metering', () => ({
  recordUsage: vi.fn()
}));

vi.mock('@platform/utils', () => ({
  loadConfig: vi.fn()
}));

vi.mock('@platform/observability', () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }))
}));

vi.mock('@platform/crud-kernel', async () => {
  const actual = await vi.importActual<any>(
    '@platform/crud-kernel'
  );

  return {
    ...actual,
    runCrudOperation: async (options: any) =>
      options.action()
  };
});

import {
  __resetRentalReservationCalendarStore,
  checkAvailability,
  createReservation,
  getCalendar
} from '../index';

describe('rental-reservation-calendar', () => {
  beforeEach(() => {
    __resetRentalReservationCalendarStore();
  });

  it('creates a reservation and reports the asset unavailable during the booking', async () => {
    const tenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();
    const assetId = crypto.randomUUID();
    const clientId = crypto.randomUUID();

    const reservation = await createReservation(
      tenantId,
      actorId,
      assetId,
      clientId,
      '2026-09-01T10:00:00.000Z',
      '2026-09-03T10:00:00.000Z',
      24
    );

    expect(reservation.status).toBe('reserved');

    await expect(
      checkAvailability(
        tenantId,
        actorId,
        assetId,
        '2026-09-03T09:00:00.000Z',
        '2026-09-03T12:00:00.000Z'
      )
    ).resolves.toBe(false);
  });

  it('rejects overlapping reservations', async () => {
    const tenantId = crypto.randomUUID();
    const assetId = crypto.randomUUID();

    await createReservation(
      tenantId,
      crypto.randomUUID(),
      assetId,
      crypto.randomUUID(),
      '2026-10-01T00:00:00.000Z',
      '2026-10-05T00:00:00.000Z'
    );

    await expect(
      createReservation(
        tenantId,
        crypto.randomUUID(),
        assetId,
        crypto.randomUUID(),
        '2026-10-04T00:00:00.000Z',
        '2026-10-06T00:00:00.000Z'
      )
    ).rejects.toThrow();
  });

  it('keeps calendar results tenant-scoped', async () => {
    const tenantId = crypto.randomUUID();
    const otherTenantId = crypto.randomUUID();
    const assetId = crypto.randomUUID();

    await createReservation(
      tenantId,
      crypto.randomUUID(),
      assetId,
      crypto.randomUUID(),
      '2026-11-05T00:00:00.000Z',
      '2026-11-06T00:00:00.000Z'
    );

    await createReservation(
      otherTenantId,
      crypto.randomUUID(),
      assetId,
      crypto.randomUUID(),
      '2026-11-07T00:00:00.000Z',
      '2026-11-08T00:00:00.000Z'
    );

    const calendar = await getCalendar(
      tenantId,
      crypto.randomUUID(),
      assetId,
      '2026-11'
    );

    expect(calendar).toHaveLength(1);
    expect(calendar[0].tenantId).toBe(tenantId);
  });
});
