import { BotSpecification } from '@platform/bot-registry';
import { TaxAssistantBot, computeMarginalTax, TaxBracket } from '../employees/tax-assistant';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'E-12',
    role: 'Test Tax Assistant used to verify marginal tax calculation.',
    triggerConditions: ['manual'],
    behaviorDescription: 'Test-only Tax Assistant used to verify real progressive tax math.',
    permissionScope: ['read:tax-data'],
    hitlClassification: 'Logging',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

const BRACKETS: TaxBracket[] = [
  { threshold: 0, rate: 0.1 },
  { threshold: 50000, rate: 0.2 },
  { threshold: 100000, rate: 0.3 },
];

describe('computeMarginalTax (pure progressive tax math)', () => {
  it('taxes income entirely within the first bracket correctly', () => {
    expect(computeMarginalTax(30000, BRACKETS)).toBe(3000);
  });

  it('taxes income spanning two brackets correctly', () => {
    expect(computeMarginalTax(75000, BRACKETS)).toBe(10000);
  });

  it('taxes income spanning all three brackets correctly', () => {
    expect(computeMarginalTax(150000, BRACKETS)).toBe(30000);
  });

  it('returns zero tax for zero income', () => {
    expect(computeMarginalTax(0, BRACKETS)).toBe(0);
  });
});

describe('TaxAssistantBot', () => {
  describe('calculateTax', () => {
    it('produces a real tax summary with correct effective rate', async () => {
      const bot = new TaxAssistantBot(makeSpec());
      const summary = await bot.calculateTax(75000, BRACKETS);

      expect(summary.taxOwed).toBe(10000);
      expect(summary.effectiveRate).toBeCloseTo(10000 / 75000);
    });

    it('blocks calculation without read:tax-data permission', async () => {
      const bot = new TaxAssistantBot(makeSpec({ permissionScope: [] }));
      await expect(bot.calculateTax(50000, BRACKETS)).rejects.toThrow('outside its declared permissionScope');
    });
  });
});
