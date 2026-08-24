import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@platform/tenancy', () => ({
  withTenantQuery: vi.fn(),
}));

vi.mock('@platform/audit', () => ({
  emit: vi.fn(),
}));

vi.mock('@platform/metering', () => ({
  recordUsage: vi.fn(),
}));

vi.mock('@platform/ai-gateway', () => ({
  generateText: vi.fn(),
}));

vi.mock('@platform/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platform/utils')>();
  return { ...actual, loadConfig: vi.fn() };
});

import { createFinancialModel, runSensitivity, explainVariance } from '../index';
import { withTenantQuery } from '@platform/tenancy';
import { generateText } from '@platform/ai-gateway';
import { loadConfig } from '@platform/utils';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const ACTOR_ID = '22222222-2222-2222-2222-222222222222';
const IDEA_ID = '33333333-3333-3333-3333-333333333333';

beforeEach(() => {
  vi.clearAllMocks();
  (loadConfig as any).mockReturnValue({
    enabled: true,
    limits: { modelsPerMonth: 20, scenariosPerModel: 5 },
    defaults: { currency: 'CAD', discountRate: 0.08 },
  });
  (withTenantQuery as any).mockImplementation((sql: string) => {
    if (sql.includes('SELECT COUNT')) return Promise.resolve([{ count: '0' }]);
    return Promise.resolve([{ id: 'row-1' }]);
  });
});

describe('financial-modeling.createFinancialModel', () => {
  it('computes break-even deterministically without calling the LLM', async () => {
    const result = await createFinancialModel(TENANT_ID, ACTOR_ID, {
      ideaId: IDEA_ID,
      startupCosts: { equipment: 20000, licensing: 5000 },
      operatingCosts: { rent: 1000, labor: 3000 },
      revenueAssumptions: { monthlyRevenueRampCad: [2000, 4000, 6000, 10000, 14000, 18000] },
    });
    expect(result.totalStartupCosts).toBe(25000);
    expect(result.monthlyOperatingCosts).toBe(4000);
    expect(result.breakEvenMonth).toBe(6);
    expect(generateText).not.toHaveBeenCalled();
  });

  it('returns null break-even if revenue never covers costs + startup capital', async () => {
    const result = await createFinancialModel(TENANT_ID, ACTOR_ID, {
      ideaId: IDEA_ID,
      startupCosts: { equipment: 500000 },
      operatingCosts: { rent: 10000 },
      revenueAssumptions: { monthlyRevenueRampCad: [100, 100, 100] },
    });
    expect(result.breakEvenMonth).toBeNull();
  });

  it('enforces the monthly model quota', async () => {
    (withTenantQuery as any).mockImplementation((sql: string) => {
      if (sql.includes('SELECT COUNT')) return Promise.resolve([{ count: '999' }]);
      return Promise.resolve([{ id: 'row-1' }]);
    });
    await expect(
      createFinancialModel(TENANT_ID, ACTOR_ID, {
        ideaId: IDEA_ID,
        startupCosts: {},
        operatingCosts: {},
        revenueAssumptions: { monthlyRevenueRampCad: [] },
      }),
    ).rejects.toThrow();
  });
});

describe('financial-modeling.runSensitivity', () => {
  it('generates the default scenario set with adjusted revenue/costs', async () => {
    const results = await runSensitivity(TENANT_ID, ACTOR_ID, {
      modelId: 'model-1',
      startupCosts: { equipment: 10000 },
      operatingCosts: { rent: 1000 },
      revenueAssumptions: { monthlyRevenueRampCad: [2000, 2000, 2000] },
    });
    expect(results.length).toBe(4);
    expect(results.find((r: any) => r.name === 'base')).toBeDefined();
    expect(results.find((r: any) => r.name === 'worst_case')).toBeDefined();
  });

  it('rejects scenario sets larger than the configured limit', async () => {
    const tooMany = Array.from({ length: 10 }, (_, i) => ({
      name: `s${i}`,
      revenueMultiplier: 1,
      costMultiplier: 1,
    }));
    await expect(
      runSensitivity(TENANT_ID, ACTOR_ID, {
        modelId: 'model-1',
        startupCosts: {},
        operatingCosts: {},
        revenueAssumptions: { monthlyRevenueRampCad: [] },
        scenarios: tooMany,
      }),
    ).rejects.toThrow();
  });
});

describe('financial-modeling.explainVariance', () => {
  it('narrates precomputed numbers without recomputing them', async () => {
    (generateText as any).mockResolvedValue({
      provider: 'groq',
      model: 'llama-3.3-70b-versatile',
      content: 'This business survives a revenue miss but not a combined worst case.',
      finishReason: 'stop',
    });
    const result = await explainVariance(TENANT_ID, ACTOR_ID, {
      modelId: 'model-1',
      baseResult: {
        modelId: 'model-1',
        currency: 'CAD',
        totalStartupCosts: 10000,
        monthlyOperatingCosts: 1000,
        breakEvenMonth: 6,
        breakEvenRevenue: 2000,
        twelveMonthNet: 5000,
      },
      scenarioResults: [],
    });
    expect(result.narrative).toContain('worst case');
  });
});
