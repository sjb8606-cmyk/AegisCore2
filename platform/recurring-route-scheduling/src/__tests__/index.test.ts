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
    limits: {
      maxVisitsPerContract: 100
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
  __resetRecurringRouteSchedulingStore,
  assignRouteOrder,
  createRecurringRoute,
  generateNextVisit,
  getRecurringRoute,
  skipVisit
} from '../index';

describe('recurring-route-scheduling', () => {
  beforeEach(() => {
    __resetRecurringRouteSchedulingStore();
  });

  it('creates a route and generates its next visit', async () => {
    const tenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();
    const contractId = crypto.randomUUID();

    const route = await createRecurringRoute(tenantId, actorId, {
      contractId,
      frequency: 'weekly',
      nextVisitDate: new Date('2026-09-01T00:00:00Z'),
      routeGroupId: null,
      status: 'active'
    });

    const visit = await generateNextVisit(
      tenantId,
      actorId,
      contractId
    );

    expect(route.contractId).toBe(contractId);
    expect(visit.contractId).toBe(contractId);

    const updated = await getRecurringRoute(
      tenantId,
      actorId,
      contractId
    );

    expect(updated.nextVisitDate.toISOString()).toBe(
      '2026-09-08T00:00:00.000Z'
    );
  });

  it('rejects skipping a visit without a reason', async () => {
    const tenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();
    const contractId = crypto.randomUUID();

    await createRecurringRoute(tenantId, actorId, {
      contractId,
      frequency: 'monthly',
      nextVisitDate: new Date('2026-09-01T00:00:00Z'),
      routeGroupId: null,
      status: 'active'
    });

    const visit = await generateNextVisit(
      tenantId,
      actorId,
      contractId
    );

    await expect(
      skipVisit(tenantId, actorId, visit.id, '   ')
    ).rejects.toThrow();
  });

  it('keeps route ordering tenant-scoped', async () => {
    const tenantId = crypto.randomUUID();
    const otherTenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();

    for (const tenant of [tenantId, otherTenantId]) {
      const contractId = crypto.randomUUID();

      await createRecurringRoute(tenant, actorId, {
        contractId,
        frequency: 'weekly',
        nextVisitDate: new Date('2026-09-10T00:00:00Z'),
        routeGroupId: null,
        status: 'active'
      });

      await generateNextVisit(tenant, actorId, contractId);
    }

    const visits = await assignRouteOrder(
      tenantId,
      actorId,
      crypto.randomUUID(),
      new Date('2026-09-10T00:00:00Z')
    );

    expect(visits).toHaveLength(1);
    expect(visits[0].tenantId).toBe(tenantId);
    expect(visits[0].routeOrder).toBe(1);
  });
});
