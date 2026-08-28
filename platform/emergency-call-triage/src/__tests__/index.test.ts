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

vi.mock('@platform/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platform/utils')>();
  return {
    ...actual,
  loadConfig: vi.fn()

  };
});

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
  __resetEmergencyCallTriageStore,
  __setShutoffLocation,
  calculatePriorityDispatch,
  createEmergencyCall,
  getShutoffLocation
} from '../index';

describe('emergency-call-triage', () => {
  beforeEach(() => {
    __resetEmergencyCallTriageStore();
  });

  it('classifies a burst pipe and creates an urgent response', async () => {
    const tenantId = crypto.randomUUID();
    const propertyId = crypto.randomUUID();

    const call = await createEmergencyCall(
      tenantId,
      crypto.randomUUID(),
      crypto.randomUUID(),
      propertyId,
      'The main pipe has burst and water is flooding the basement'
    );

    expect(call.severity).toBe('active_leak');
    expect(
      call.estimatedResponseTimeMinutes
    ).toBe(60);
  });

  it('rejects an empty emergency description', async () => {
    await expect(
      createEmergencyCall(
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
        '   '
      )
    ).rejects.toThrow();
  });

  it('keeps water shutoff locations tenant-scoped', async () => {
    const tenantId = crypto.randomUUID();
    const propertyId = crypto.randomUUID();

    __setShutoffLocation(
      tenantId,
      propertyId,
      'Basement utility room'
    );

    const ownLocation =
      await getShutoffLocation(
        tenantId,
        crypto.randomUUID(),
        propertyId
      );

    const otherLocation =
      await getShutoffLocation(
        crypto.randomUUID(),
        crypto.randomUUID(),
        propertyId
      );

    expect(ownLocation)
      .toBe('Basement utility room');

    expect(otherLocation)
      .toBeNull();

    const priority =
      await calculatePriorityDispatch(
        tenantId,
        crypto.randomUUID(),
        'sewage_backup'
      );

    expect(priority).toBe(30);
  });
});
