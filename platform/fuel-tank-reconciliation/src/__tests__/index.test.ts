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
      varianceAlertLiters: 50,
      fuelGrades: ['gas', 'diesel'],
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
  createTank,
  recordDelivery,
  recordPumpSale,
  recordStickReading,
  reconcileTank,
  __resetFuelTankStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';

describe('fuel-tank-reconciliation', () => {
  beforeEach(() => {
    __resetFuelTankStore();
    vi.clearAllMocks();
  });

  it('tracks book inventory through delivery and sales', async () => {
    const tank = await createTank(tenantId, actorId, {
      label: 'Diesel Main',
      grade: 'diesel',
      capacityLiters: 10000,
      openingLiters: 1000,
    });
    await recordDelivery(tenantId, actorId, { tankId: tank.id, liters: 500 });
    await recordPumpSale(tenantId, actorId, { tankId: tank.id, liters: 200 });
    const result = await reconcileTank(tenantId, actorId, tank.id, 1300);
    expect(result.bookLiters).toBe(1300);
    expect(result.varianceLiters).toBe(0);
    expect(result.alert).toBe(false);
  });

  it('alerts on variance above threshold', async () => {
    const tank = await createTank(tenantId, actorId, {
      label: 'Gas',
      grade: 'gas',
      capacityLiters: 5000,
      openingLiters: 2000,
    });
    await recordStickReading(tenantId, actorId, {
      tankId: tank.id,
      liters: 1800,
    });
    const result = await reconcileTank(tenantId, actorId, tank.id);
    expect(result.varianceLiters).toBe(-200);
    expect(result.alert).toBe(true);
  });

  it('rejects sale over book and over-capacity delivery', async () => {
    const tank = await createTank(tenantId, actorId, {
      label: 'Small',
      grade: 'gas',
      capacityLiters: 100,
      openingLiters: 50,
    });
    await expect(
      recordPumpSale(tenantId, actorId, { tankId: tank.id, liters: 80 }),
    ).rejects.toThrow(/exceeds book/i);
    await expect(
      recordDelivery(tenantId, actorId, { tankId: tank.id, liters: 60 }),
    ).rejects.toThrow(/capacity/i);
  });
});
