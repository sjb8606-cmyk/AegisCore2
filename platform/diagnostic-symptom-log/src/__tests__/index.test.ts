import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  __resetDiagnosticSymptomLogStore,
  logSymptoms,
  recordDiagnosis,
  getDiagnosisHistory
} from '../index';

describe('diagnostic-symptom-log', () => {
  beforeEach(() => {
    __resetDiagnosticSymptomLogStore();
  });

  it('logs symptoms and records a diagnosis', async () => {
    const tenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    const applianceId = crypto.randomUUID();

    const diagnosis = await logSymptoms(
      tenantId,
      actorId,
      jobId,
      applianceId,
      'Unit is leaking water'
    );

    const updated = await recordDiagnosis(
      tenantId,
      actorId,
      diagnosis.diagnosisId,
      'Failed inlet valve',
      {
        repairRecommended: true,
        replacementRecommended: false
      }
    );

    expect(updated.diagnosedIssue).toBe(
      'Failed inlet valve'
    );
    expect(updated.repairRecommended).toBe(true);
  });

  it('rejects empty symptoms', async () => {
    await expect(
      logSymptoms(
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
        '   '
      )
    ).rejects.toThrow();
  });

  it('returns only the requesting tenant history', async () => {
    const tenantId = crypto.randomUUID();
    const otherTenant = crypto.randomUUID();
    const actorId = crypto.randomUUID();
    const applianceId = crypto.randomUUID();

    await logSymptoms(
      tenantId,
      actorId,
      crypto.randomUUID(),
      applianceId,
      'Noisy operation'
    );

    await logSymptoms(
      otherTenant,
      actorId,
      crypto.randomUUID(),
      applianceId,
      'Different tenant symptom'
    );

    const history = await getDiagnosisHistory(
      tenantId,
      actorId,
      applianceId
    );

    expect(history).toHaveLength(1);
    expect(history[0].reportedSymptoms).toBe(
      'Noisy operation'
    );
  });
});
