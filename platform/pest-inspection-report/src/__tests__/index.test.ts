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
  __resetPestInspectionReportStore,
  createReport,
  generateTreatmentRecommendation,
  scheduleFollowUp
} from '../index';

describe('pest-inspection-report', () => {
  beforeEach(() => {
    __resetPestInspectionReportStore();
  });

  it('creates a report with a deterministic treatment recommendation', async () => {
    const report = await createReport(
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
      'ants',
      'moderate',
      ['Kitchen', 'Rear entrance']
    );

    expect(report.pestType).toBe('ants');
    expect(report.followUpRequired).toBe(true);
    expect(
      report.recommendedTreatmentPlan
    ).toContain('ants');
  });

  it('rejects a report without inspection locations', async () => {
    await expect(
      createReport(
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
        'rodents',
        'high',
        []
      )
    ).rejects.toThrow();
  });

  it('schedules a follow-up while preserving tenant isolation', async () => {
    const tenantId = crypto.randomUUID();

    const report = await createReport(
      tenantId,
      crypto.randomUUID(),
      crypto.randomUUID(),
      'wasps',
      'high',
      ['Garage']
    );

    const updated = await scheduleFollowUp(
      tenantId,
      crypto.randomUUID(),
      report.reportId,
      new Date('2026-09-15')
    );

    expect(updated.followUpRequired).toBe(true);
    expect(updated.followUpDate)
      .toEqual(new Date('2026-09-15'));

    expect(
      generateTreatmentRecommendation(
        'wasps',
        'infestation'
      )
    ).toContain('immediate');
  });
});
