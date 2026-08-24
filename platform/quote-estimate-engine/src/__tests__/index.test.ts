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
  const actual = await vi.importActual<any>('@platform/crud-kernel');

  return {
    ...actual,
    runCrudOperation: async (options: any) =>
      options.action()
  };
});

import {
  __resetQuoteEstimateEngineStore,
  acceptQuote,
  applyAdjustment,
  calculateQuote,
  convertToContract
} from '../index';

describe('quote-estimate-engine', () => {
  beforeEach(() => {
    __resetQuoteEstimateEngineStore();
  });

  it('calculates a quote and applies an adjustment', async () => {
    const tenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();
    const clientId = crypto.randomUUID();

    const quote = await calculateQuote(
      tenantId,
      actorId,
      clientId,
      2000,
      'lawn',
      'weekly'
    );

    expect(quote.status).toBe('draft');
    expect(quote.baseRate).toBeGreaterThan(0);

    const adjusted = await applyAdjustment(
      tenantId,
      actorId,
      quote.id,
      'Large property discount',
      -10
    );

    expect(adjusted.adjustments).toHaveLength(1);
    expect(adjusted.totalPrice).toBe(
      adjusted.baseRate - 10
    );
  });

  it('rejects invalid property size', async () => {
    await expect(
      calculateQuote(
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
        0,
        'lawn',
        'weekly'
      )
    ).rejects.toThrow();
  });

  it('converts an accepted quote into a contract record', async () => {
    const tenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();
    const clientId = crypto.randomUUID();

    const quote = await calculateQuote(
      tenantId,
      actorId,
      clientId,
      1500,
      'commercial cleaning',
      'monthly'
    );

    await acceptQuote(
      tenantId,
      actorId,
      quote.id
    );

    const contract = await convertToContract(
      tenantId,
      actorId,
      quote.id
    );

    expect(contract.quoteId).toBe(quote.id);
    expect(contract.clientId).toBe(clientId);
    expect(contract.contractId).toMatch(
      /^[0-9a-f-]{36}$/
    );
  });
});
