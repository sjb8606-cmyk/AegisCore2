import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

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
  __resetOnDemandDispatchRequestStore,
  assignDriver,
  calculateEta,
  createRequest,
  updateStatus
} from '../index';

describe('on-demand-dispatch-request', () => {
  beforeEach(() => {
    __resetOnDemandDispatchRequestStore();
  });

  it('creates and assigns an emergency request', async () => {
    const tenantId = crypto.randomUUID();
    const clientId = crypto.randomUUID();
    const driverId = crypto.randomUUID();

    const request = await createRequest(
      tenantId,
      crypto.randomUUID(),
      clientId,
      '123 Main Street',
      'emergency'
    );

    const assigned = await assignDriver(
      tenantId,
      crypto.randomUUID(),
      request.requestId,
      driverId
    );

    expect(assigned.status).toBe('assigned');
    expect(assigned.driverId).toBe(driverId);
  });

  it('rejects an empty location', async () => {
    await expect(
      createRequest(
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
        '   ',
        'same_day'
      )
    ).rejects.toThrow();
  });

  it('calculates the nearest available driver ETA', async () => {
    const tenantId = crypto.randomUUID();

    const eta = await calculateEta(
      tenantId,
      crypto.randomUUID(),
      '456 Oak Street',
      [
        {
          driverId: crypto.randomUUID(),
          etaMinutes: 35
        },
        {
          driverId: crypto.randomUUID(),
          etaMinutes: 18
        }
      ]
    );

    expect(eta).toBe(18);

    const request = await createRequest(
      tenantId,
      crypto.randomUUID(),
      crypto.randomUUID(),
      '456 Oak Street',
      'scheduled'
    );

    const updated = await updateStatus(
      tenantId,
      crypto.randomUUID(),
      request.requestId,
      'en_route'
    );

    expect(updated.status).toBe('en_route');
  });
});
