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
  loadConfig: vi.fn(() => ({
    enabled: true,
    checklist: {
      requiredFields: []
    }
    }))
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
  const actual = await vi.importActual<any>('@platform/crud-kernel');

  return {
    ...actual,
    runCrudOperation: async (options: any) => options.action()
  };
});

import {
  __resetServiceVisitLogStore,
  completeVisit,
  createVisitLog,
  getClientVisibleHistory,
  startVisit
} from '../index';

describe('service-visit-log', () => {
  beforeEach(() => {
    __resetServiceVisitLogStore();
  });

  it('starts and completes a visit with checklist data', async () => {
    const tenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();
    const visitId = crypto.randomUUID();

    await createVisitLog(tenantId, actorId, {
      visitId,
      contractId: crypto.randomUUID(),
      technicianId: crypto.randomUUID(),
      arrivalTimestamp: null,
      departureTimestamp: null,
      notes: 'Routine service',
      photos: {
        before: [],
        after: []
      },
      checklistData: {}
    });

    const started = await startVisit(
      tenantId,
      actorId,
      visitId
    );

    const completed = await completeVisit(
      tenantId,
      actorId,
      visitId,
      {
        gateChecked: true
      }
    );

    expect(started.arrivalTimestamp).not.toBeNull();
    expect(completed.departureTimestamp).not.toBeNull();
    expect(completed.checklistData).toEqual({
      gateChecked: true
    });
  });

  it('rejects completion before a visit is started', async () => {
    const tenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();
    const visitId = crypto.randomUUID();

    await createVisitLog(tenantId, actorId, {
      visitId,
      contractId: crypto.randomUUID(),
      technicianId: crypto.randomUUID(),
      arrivalTimestamp: null,
      departureTimestamp: null,
      notes: '',
      photos: {
        before: [],
        after: []
      },
      checklistData: {}
    });

    await expect(
      completeVisit(tenantId, actorId, visitId, {})
    ).rejects.toThrow();
  });

  it('does not expose another tenant visit history', async () => {
    const tenantId = crypto.randomUUID();
    const otherTenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();

    await createVisitLog(tenantId, actorId, {
      visitId: crypto.randomUUID(),
      contractId: crypto.randomUUID(),
      technicianId: crypto.randomUUID(),
      arrivalTimestamp: new Date('2026-09-01T10:00:00Z'),
      departureTimestamp: new Date('2026-09-01T10:30:00Z'),
      notes: 'Tenant one',
      photos: {
        before: [],
        after: []
      },
      checklistData: {}
    });

    await createVisitLog(otherTenantId, actorId, {
      visitId: crypto.randomUUID(),
      contractId: crypto.randomUUID(),
      technicianId: crypto.randomUUID(),
      arrivalTimestamp: new Date('2026-09-01T11:00:00Z'),
      departureTimestamp: new Date('2026-09-01T11:30:00Z'),
      notes: 'Tenant two',
      photos: {
        before: [],
        after: []
      },
      checklistData: {}
    });

    const history = await getClientVisibleHistory(
      tenantId,
      actorId,
      crypto.randomUUID()
    );

    expect(history).toHaveLength(1);
    expect(history[0].tenantId).toBe(tenantId);
  });
});
