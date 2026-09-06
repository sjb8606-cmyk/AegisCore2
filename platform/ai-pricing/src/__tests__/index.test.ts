import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@platform/tenancy', () => ({
  withTenantQuery: vi.fn(),
}));
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import { createRule, computePrice, runABTest, getPricingLedger } from '../index';
import { withTenantQuery } from '@platform/tenancy';
import * as fs from 'fs';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const ENTITY_ID = '22222222-2222-2222-2222-222222222222';

function mockConfig(cfg: any) {
  (fs.existsSync as any).mockReturnValue(true);
  (fs.readFileSync as any).mockReturnValue(JSON.stringify(cfg));
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('computePrice', () => {
  it('leaves price unchanged when no surge rule applies and demand is normal', async () => {
    mockConfig({ enabled: true, tiers: { basicPricingRules: true }, thresholds: { minMargin: 0.15 } });
    (withTenantQuery as any)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{}]);

    const result = await computePrice(TENANT_ID, { entity_id: ENTITY_ID, base_price: 100, demand_factor: 1.0 });

    expect(result.computed_price).toBe(100);
    expect(result.floor_applied).toBe(false);
  });

  it('applies the surge multiplier only when demand_factor exceeds 1.5', async () => {
    mockConfig({ enabled: true, tiers: { basicPricingRules: true }, thresholds: { minMargin: 0.15 } });
    const surgeRule = { rule_type: 'surge', config: JSON.stringify({ multiplier: '1.30' }), active: true, priority: 1 };
    (withTenantQuery as any)
      .mockResolvedValueOnce([surgeRule])
      .mockResolvedValueOnce([{}]);

    const result = await computePrice(TENANT_ID, { entity_id: ENTITY_ID, base_price: 100, demand_factor: 2.0 });

    expect(result.computed_price).toBe(130);
  });

  it('does NOT apply the surge multiplier when demand_factor is at or below 1.5', async () => {
    mockConfig({ enabled: true, tiers: { basicPricingRules: true }, thresholds: { minMargin: 0.15 } });
    const surgeRule = { rule_type: 'surge', config: JSON.stringify({ multiplier: '1.30' }), active: true, priority: 1 };
    (withTenantQuery as any)
      .mockResolvedValueOnce([surgeRule])
      .mockResolvedValueOnce([{}]);

    const result = await computePrice(TENANT_ID, { entity_id: ENTITY_ID, base_price: 100, demand_factor: 1.5 });

    expect(result.computed_price).toBe(100); // threshold is strictly > 1.5, not >=
  });

  // FINDING: as currently written, finalPrice can only ever increase (via the
  // surge multiplier) — there's no discount/markdown rule_type implemented.
  // That means the price-floor branch (`if finalPrice < minPrice`) is
  // unreachable dead code with today's rule set. This test documents that
  // rather than pretending to exercise the floor logic.
  it('FINDING: the price floor is currently unreachable — no rule type lowers price', async () => {
    mockConfig({ enabled: true, tiers: { basicPricingRules: true }, thresholds: { minMargin: 0.5 } });
    (withTenantQuery as any)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{}]);

    const result = await computePrice(TENANT_ID, { entity_id: ENTITY_ID, base_price: 100, demand_factor: 1.0 });

    expect(result.floor_applied).toBe(false); // never true today, since nothing lowers finalPrice
    // TODO: either implement a discount rule_type that can trigger the floor,
    // or remove the dead floor-enforcement code if it's genuinely unneeded.
  });

  it('rounds the computed price to 2 decimal places', async () => {
    mockConfig({ enabled: true, tiers: { basicPricingRules: true }, thresholds: { minMargin: 0.15 } });
    const surgeRule = { rule_type: 'surge', config: JSON.stringify({ multiplier: '1.333' }), active: true, priority: 1 };
    (withTenantQuery as any)
      .mockResolvedValueOnce([surgeRule])
      .mockResolvedValueOnce([{}]);

    const result = await computePrice(TENANT_ID, { entity_id: ENTITY_ID, base_price: 10, demand_factor: 2.0 });

    expect(result.computed_price).toBe(13.33);
  });

  it('blocks when the basicPricingRules tier is disabled', async () => {
    mockConfig({ enabled: true, tiers: { basicPricingRules: false }, thresholds: {} });
    await expect(
      computePrice(TENANT_ID, { entity_id: ENTITY_ID, base_price: 100, demand_factor: 1.0 })
    ).rejects.toThrow('AI Pricing basic rules engine tier is disabled');
    expect(withTenantQuery).not.toHaveBeenCalled();
  });

  it('rejects a malformed entity_id before touching the database', async () => {
    mockConfig({ enabled: true, tiers: { basicPricingRules: true }, thresholds: {} });
    await expect(
      computePrice(TENANT_ID, { entity_id: 'not-a-uuid', base_price: 100, demand_factor: 1.0 })
    ).rejects.toThrow();
    expect(withTenantQuery).not.toHaveBeenCalled();
  });
});

describe('createRule', () => {
  it('blocks when the basicPricingRules tier is disabled', async () => {
    mockConfig({ enabled: true, tiers: { basicPricingRules: false } });
    await expect(createRule(TENANT_ID, { entity_type: 'product', rule_type: 'surge', config: {} })).rejects.toThrow(
      'AI Pricing basic rules engine tier is disabled'
    );
  });

  it('creates a rule and returns the inserted row', async () => {
    mockConfig({ enabled: true, tiers: { basicPricingRules: true } });
    const row = { id: 'rule-1', rule_type: 'surge' };
    (withTenantQuery as any).mockResolvedValueOnce([row]);

    const result = await createRule(TENANT_ID, { entity_type: 'product', rule_type: 'surge', config: { multiplier: 1.3 } });

    expect(result).toEqual(row);
  });
});

describe('runABTest', () => {
  it('blocks when the aBTesting tier is disabled', async () => {
    mockConfig({ enabled: true, tiers: { aBTesting: false } });
    await expect(runABTest(TENANT_ID, { name: 'exp1', variants: [] })).rejects.toThrow(
      'AI Pricing A/B testing experiment tier is disabled'
    );
  });

  it('creates an experiment and returns the inserted row', async () => {
    mockConfig({ enabled: true, tiers: { aBTesting: true } });
    const row = { id: 'exp-1', name: 'exp1' };
    (withTenantQuery as any).mockResolvedValueOnce([row]);

    const result = await runABTest(TENANT_ID, { name: 'exp1', hypothesis: 'higher price = higher margin', variants: ['A', 'B'] });

    expect(result).toEqual(row);
  });
});

describe('getPricingLedger', () => {
  it('rejects a malformed entityId before touching the database', async () => {
    await expect(getPricingLedger(TENANT_ID, 'not-a-uuid')).rejects.toThrow('Invalid Entity ID format.');
    expect(withTenantQuery).not.toHaveBeenCalled();
  });

  it('returns combined history and active rules for a valid entity', async () => {
    const history = [{ id: 'h1' }];
    const activeRules = [{ id: 'r1' }];
    (withTenantQuery as any).mockResolvedValueOnce(history).mockResolvedValueOnce(activeRules);

    const result = await getPricingLedger(TENANT_ID, ENTITY_ID);

    expect(result).toEqual({ entity_id: ENTITY_ID, active_rules: activeRules, history });
  });
});
