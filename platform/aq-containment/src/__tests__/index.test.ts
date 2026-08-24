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
      reportableEscapeCountFinfish: 50,
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
  scheduleInspection,
  logInspectionResult,
  logEscapeIncident,
  getInspectionSchedule,
  __resetAqContainmentStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';

describe('aq-containment', () => {
  beforeEach(() => {
    __resetAqContainmentStore();
    vi.clearAllMocks();
  });

  it('schedules and completes inspection with photos', async () => {
    const insp = await scheduleInspection(tenantId, actorId, {
      siteId: 'site-1',
      holdingUnitId: 'cage-A',
      inspectionType: 'net_integrity',
      dueDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    });
    const done = await logInspectionResult(tenantId, actorId, {
      inspectionId: insp.id,
      passed: true,
      findings: 'No tears',
      photoUrls: ['s3://photos/net1.jpg'],
    });
    expect(done.status).toBe('completed');
    expect(done.photoUrls).toHaveLength(1);
    const schedule = await getInspectionSchedule(tenantId, 'site-1');
    expect(schedule).toHaveLength(1);
  });

  it('flags reportable escape at >= 50 finfish', async () => {
    const small = await logEscapeIncident(tenantId, actorId, {
      siteId: 'site-1',
      estimatedCount: 10,
      species: 'Atlantic salmon',
      cause: 'predator',
    });
    expect(small.reportable).toBe(false);
    expect(small.reviewStatus).toBe('cleared');

    const big = await logEscapeIncident(tenantId, actorId, {
      siteId: 'site-1',
      estimatedCount: 50,
      species: 'Atlantic salmon',
      cause: 'net failure',
    });
    expect(big.reportable).toBe(true);
    expect(big.reviewStatus).toBe('pending_review');
  });

  it('rejects invalid inspection type', async () => {
    await expect(
      scheduleInspection(tenantId, actorId, {
        siteId: 's1',
        inspectionType: 'drone_flyby' as any,
        dueDate: '2026-09-01',
      }),
    ).rejects.toThrow(/inspectionType/i);
  });
});
