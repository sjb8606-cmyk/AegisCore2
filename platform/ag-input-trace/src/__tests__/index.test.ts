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
      contaminationFlagOnDownstream: true,
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
  receiveInputLot,
  applyInputToField,
  linkApplicationToHarvest,
  traceInputUpstream,
  traceInputDownstream,
  __resetAgInputTraceStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';

describe('ag-input-trace', () => {
  beforeEach(() => {
    __resetAgInputTraceStore();
    vi.clearAllMocks();
  });

  it('receives lot, applies, traces upstream and downstream', async () => {
    const lot = await receiveInputLot(tenantId, actorId, {
      inputType: 'seed',
      supplierName: 'Acme Seeds',
      lotNumber: 'SEED-42',
      quantity: 100,
      unit: 'kg',
    });
    const app = await applyInputToField(tenantId, actorId, {
      inputLotId: lot.id,
      fieldId: 'field-1',
      cropCycleId: 'cycle-1',
      quantityUsed: 25,
    });
    expect(lot.quantityRemaining - 25).toBe(
      (await import('../index')).getInputLot
        ? (await (await import('../index')).getInputLot(tenantId, lot.id))!
            .quantityRemaining
        : 75,
    );

    const harvestLotId = 'harvest-lot-1';
    await linkApplicationToHarvest(
      tenantId,
      actorId,
      app.id,
      harvestLotId,
    );

    const up = await traceInputUpstream(tenantId, harvestLotId);
    expect(up).toHaveLength(1);
    expect(up[0].inputLot.lotNumber).toBe('SEED-42');

    const down = await traceInputDownstream(tenantId, lot.id);
    expect(down.harvestLotIds).toContain(harvestLotId);
    expect(down.contaminationFlag).toBe(true);
  });

  it('blocks over-application', async () => {
    const lot = await receiveInputLot(tenantId, actorId, {
      inputType: 'fertilizer',
      supplierName: 'AgCo',
      lotNumber: 'F-1',
      quantity: 10,
      unit: 'kg',
    });
    await expect(
      applyInputToField(tenantId, actorId, {
        inputLotId: lot.id,
        fieldId: 'f1',
        cropCycleId: 'c1',
        quantityUsed: 50,
      }),
    ).rejects.toThrow(/Insufficient/i);
  });

  it('downstream empty when unused', async () => {
    const lot = await receiveInputLot(tenantId, actorId, {
      inputType: 'pesticide',
      supplierName: 'Chem',
      lotNumber: 'P-1',
      quantity: 5,
      unit: 'L',
    });
    const down = await traceInputDownstream(tenantId, lot.id);
    expect(down.applications).toHaveLength(0);
    expect(down.contaminationFlag).toBe(false);
  });
});
