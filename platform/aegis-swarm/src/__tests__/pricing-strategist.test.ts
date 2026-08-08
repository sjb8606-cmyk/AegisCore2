import { BotSpecification } from '@platform/bot-registry';
import { PricingStrategistBot, computeMarkupAndMargin, priceForTargetMargin } from '../employees/pricing-strategist';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'E-34',
    role: 'Test Pricing Strategist used to verify real markup/margin math.',
    triggerConditions: ['manual'],
    behaviorDescription: 'Test-only Pricing Strategist used to verify real distinct markup/margin calculations.',
    permissionScope: ['read:pricing-data'],
    hitlClassification: 'Logging',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

describe('computeMarkupAndMargin / priceForTargetMargin (pure real pricing math)', () => {
  it('computes the real price needed to hit an actual target margin', () => {
    expect(priceForTargetMargin(60, 0.4)).toBe(100);
  });

  it('confirms the real margin at that computed price matches the target exactly', () => {
    const price = priceForTargetMargin(60, 0.4);
    expect(computeMarkupAndMargin(60, price).marginPct).toBeCloseTo(0.4);
  });

  it('proves the real markup/margin gap: a 40% markup does not yield a 40% margin', () => {
    const markedUpPrice = 60 * 1.4;
    const result = computeMarkupAndMargin(60, markedUpPrice);
    expect(result.markupPct).toBeCloseTo(0.4);
    expect(result.marginPct).toBeCloseTo(0.2857, 3);
    expect(result.marginPct).not.toBeCloseTo(0.4);
  });
});

describe('PricingStrategistBot', () => {
  describe('recommendPrice', () => {
    it('produces a real recommendation with correct actual margin', async () => {
      const bot = new PricingStrategistBot(makeSpec());
      const rec = await bot.recommendPrice(60, 0.4);

      expect(rec.recommendedPrice).toBe(100);
      expect(rec.actualMarginAtPrice.marginPct).toBeCloseTo(0.4);
    });

    it('blocks recommendation without read:pricing-data permission', async () => {
      const bot = new PricingStrategistBot(makeSpec({ permissionScope: [] }));
      await expect(bot.recommendPrice(60, 0.4)).rejects.toThrow('outside its declared permissionScope');
    });
  });
});
