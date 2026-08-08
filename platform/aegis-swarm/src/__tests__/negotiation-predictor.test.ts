import { BotSpecification } from '@platform/bot-registry';
import { NegotiationPredictorBot, computeZopa, NegotiationPosition } from '../employees/negotiation-predictor';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'E-28',
    role: 'Test Negotiation Predictor used to verify real ZOPA math.',
    triggerConditions: ['manual'],
    behaviorDescription: 'Test-only Negotiation Predictor used to verify real ZOPA calculation.',
    permissionScope: ['generate:negotiation-prep'],
    hitlClassification: 'Logging',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

function position(overrides: Partial<NegotiationPosition> = {}): NegotiationPosition {
  return {
    yourMinAcceptable: 8000,
    yourOpeningOffer: 10000,
    theirMaxAcceptable: 12000,
    theirOpeningOffer: 6000,
    ...overrides,
  };
}

describe('computeZopa (pure real ZOPA math)', () => {
  it('confirms a real ZOPA exists and computes the correct midpoint', () => {
    const result = computeZopa(position());
    expect(result.zopaExists).toBe(true);
    expect(result.zopaRange).toEqual([8000, 12000]);
    expect(result.midpoint).toBe(10000);
  });

  it('confirms no ZOPA when positions genuinely do not overlap', () => {
    const result = computeZopa(position({ yourMinAcceptable: 15000, theirMaxAcceptable: 12000 }));
    expect(result.zopaExists).toBe(false);
    expect(result.zopaRange).toBeNull();
  });

  it('honestly reports unknown rather than guessing when their max is not known', () => {
    const result = computeZopa(position({ theirMaxAcceptable: null }));
    expect(result.zopaExists).toBeNull();
    expect(result.midpoint).toBeNull();
  });
});

describe('NegotiationPredictorBot', () => {
  describe('prepareNegotiation', () => {
    it('produces a real prep with all five response scenarios covered', async () => {
      const bot = new NegotiationPredictorBot(makeSpec());
      const prep = await bot.prepareNegotiation(position(), 'vendor contract renewal');

      expect(prep.zopa.zopaExists).toBe(true);
      expect(prep.assembledPrompt).toContain('accept');
      expect(prep.assembledPrompt).toContain('counter_higher');
      expect(prep.assembledPrompt).toContain('walk_away');
    });

    it('honestly reflects the unknown case in the assembled prompt', async () => {
      const bot = new NegotiationPredictorBot(makeSpec());
      const prep = await bot.prepareNegotiation(position({ theirMaxAcceptable: null }), 'context');

      expect(prep.assembledPrompt).toContain('unknown');
    });

    it('blocks prep without generate:negotiation-prep permission', async () => {
      const bot = new NegotiationPredictorBot(makeSpec({ permissionScope: [] }));
      await expect(bot.prepareNegotiation(position(), 'x')).rejects.toThrow('outside its declared permissionScope');
    });
  });
});
