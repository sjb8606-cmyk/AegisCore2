import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { FinancialArchitectBot, computeBurnAndRunway, computeDilution } from '../employees/financial-architect';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'E-27',
    role: 'Test Financial Architect used to verify real burn/runway/dilution math.',
    triggerConditions: ['manual'],
    behaviorDescription: 'Test-only Financial Architect used to verify real finance formulas.',
    permissionScope: ['read:financial-data'],
    hitlClassification: 'Logging',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

describe('computeBurnAndRunway (pure real burn/runway math)', () => {
  it('computes real burn and runway when spending more than earning', () => {
    const result = computeBurnAndRunway(5000, 20000, 150000);
    expect(result.netBurn).toBe(15000);
    expect(result.runwayMonths).toBe(10);
  });

  it('reports infinite runway for a genuinely profitable company', () => {
    const result = computeBurnAndRunway(30000, 20000, 150000);
    expect(result.netBurn).toBeLessThan(0);
    expect(result.runwayMonths).toBe(Infinity);
  });
});

describe('computeDilution (pure real cap table mechanics)', () => {
  it('computes real founder retention after a real raise', () => {
    const result = computeDilution(2000000, 500000, 1.0);
    expect(result.postMoneyValuation).toBe(2500000);
    expect(result.newInvestorPct).toBeCloseTo(0.2);
    expect(result.newExistingPct).toBeCloseTo(0.8);
  });
});

describe('FinancialArchitectBot', () => {
  describe('assessFinancials', () => {
    it('flags a genuine low-runway warning', async () => {
      const bot = new FinancialArchitectBot(makeSpec());
      const snapshot = await bot.assessFinancials(5000, 30000, 100000);
      expect(snapshot.runwayWarning).toBe(true);
    });

    it('does not flag a warning for healthy runway', async () => {
      const bot = new FinancialArchitectBot(makeSpec());
      const snapshot = await bot.assessFinancials(5000, 20000, 300000);
      expect(snapshot.runwayWarning).toBe(false);
    });

    it('signals the swarm on a real low-runway warning', async () => {
      const bot = new FinancialArchitectBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.assessFinancials(5000, 30000, 100000);

      expect(received).toHaveLength(1);
      unsubscribe();
    });

    it('blocks assessment without read:financial-data permission', async () => {
      const bot = new FinancialArchitectBot(makeSpec({ permissionScope: [] }));
      await expect(bot.assessFinancials(5000, 20000, 100000)).rejects.toThrow('outside its declared permissionScope');
    });
  });

  describe('simulateDilution', () => {
    it('produces a real dilution simulation', async () => {
      const bot = new FinancialArchitectBot(makeSpec());
      const result = await bot.simulateDilution(2000000, 500000, 1.0);
      expect(result.newExistingPct).toBeCloseTo(0.8);
    });
  });
});
