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
  __resetElectricalPanelCircuitInventoryStore,
  addCircuit,
  flagOutdatedCodeCompliance,
  registerPanel
} from '../index';

describe('electrical-panel-circuit-inventory', () => {
  beforeEach(() => {
    __resetElectricalPanelCircuitInventoryStore();
  });

  it('registers a panel and adds a circuit', async () => {
    const tenantId = crypto.randomUUID();

    const panel = await registerPanel(
      tenantId,
      crypto.randomUUID(),
      crypto.randomUUID(),
      200,
      '2024'
    );

    const updated = await addCircuit(
      tenantId,
      crypto.randomUUID(),
      panel.panelId,
      {
        circuitNumber: 1,
        breakerAmperage: 20,
        labeledUse: 'Kitchen receptacles',
        lastInspectedDate: new Date('2026-08-01')
      }
    );

    expect(updated.circuits).toHaveLength(1);
    expect(updated.circuits[0].circuitNumber).toBe(1);
  });

  it('rejects duplicate circuit numbers', async () => {
    const tenantId = crypto.randomUUID();

    const panel = await registerPanel(
      tenantId,
      crypto.randomUUID(),
      crypto.randomUUID(),
      100,
      '2024'
    );

    const circuit = {
      circuitNumber: 1,
      breakerAmperage: 15,
      labeledUse: 'Lighting',
      lastInspectedDate: null
    };

    await addCircuit(
      tenantId,
      crypto.randomUUID(),
      panel.panelId,
      circuit
    );

    await expect(
      addCircuit(
        tenantId,
        crypto.randomUUID(),
        panel.panelId,
        circuit
      )
    ).rejects.toThrow();
  });

  it('keeps panel records tenant-scoped', async () => {
    const tenantId = crypto.randomUUID();

    const panel = await registerPanel(
      tenantId,
      crypto.randomUUID(),
      crypto.randomUUID(),
      200,
      '2024'
    );

    await expect(
      flagOutdatedCodeCompliance(
        crypto.randomUUID(),
        crypto.randomUUID(),
        panel.panelId
      )
    ).rejects.toThrow();
  });
});
