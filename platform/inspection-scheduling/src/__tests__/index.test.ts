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
  __resetInspectionSchedulingStore,
  getPendingInspections,
  recordResult,
  scheduleInspection
} from '../index';

describe('inspection-scheduling', () => {
  beforeEach(() => {
    __resetInspectionSchedulingStore();
  });

  it('schedules a pending inspection', async () => {
    const inspection =
      await scheduleInspection(
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
        'Jane Inspector',
        new Date('2026-09-15T13:00:00Z')
      );

    expect(inspection.result).toBe('pending');
    expect(inspection.inspectorName)
      .toBe('Jane Inspector');
  });

  it('records a valid inspection result', async () => {
    const tenantId = crypto.randomUUID();

    const inspection =
      await scheduleInspection(
        tenantId,
        crypto.randomUUID(),
        crypto.randomUUID(),
        'John Inspector',
        new Date('2026-09-15T13:00:00Z')
      );

    const updated =
      await recordResult(
        tenantId,
        crypto.randomUUID(),
        inspection.inspectionId,
        'passed',
        'Inspection passed.'
      );

    expect(updated.result).toBe('passed');
    expect(updated.notes)
      .toBe('Inspection passed.');
  });

  it('returns only pending inspections in the tenant and date range', async () => {
    const tenantId = crypto.randomUUID();

    await scheduleInspection(
      tenantId,
      crypto.randomUUID(),
      crypto.randomUUID(),
      'Inspector A',
      new Date('2026-09-10T10:00:00Z')
    );

    const second =
      await scheduleInspection(
        tenantId,
        crypto.randomUUID(),
        crypto.randomUUID(),
        'Inspector B',
        new Date('2026-09-20T10:00:00Z')
      );

    await recordResult(
      tenantId,
      crypto.randomUUID(),
      second.inspectionId,
      'passed'
    );

    await scheduleInspection(
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
      'Other Inspector',
      new Date('2026-09-15T10:00:00Z')
    );

    const pending =
      await getPendingInspections(
        tenantId,
        crypto.randomUUID(),
        new Date('2026-09-01T00:00:00Z'),
        new Date('2026-09-30T23:59:59Z')
      );

    expect(pending).toHaveLength(1);
    expect(pending[0].inspectorName)
      .toBe('Inspector A');
  });
});
