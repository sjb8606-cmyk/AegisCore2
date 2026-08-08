import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { DatasetFactCheckerBot, escalateForSafety, FactCheckInput } from '../employees/dataset-fact-checker';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'E-31',
    role: 'Test Dataset Fact-Checker used to verify real safety-escalation logic.',
    triggerConditions: ['manual'],
    behaviorDescription: 'Test-only Dataset Fact-Checker used to verify real escalation rules.',
    permissionScope: ['write:fact-check-results'],
    hitlClassification: 'Logging',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

function input(overrides: Partial<FactCheckInput> = {}): FactCheckInput {
  return {
    claimId: 'claim-1',
    category: 'pqc_algorithm',
    claimedValue: 'ML-KEM-768',
    claimedSource: 'NIST FIPS 203',
    independentSourceChecked: 'NIST.gov official publication',
    safetyCritical: false,
    ...overrides,
  };
}

describe('escalateForSafety (pure real escalation rule)', () => {
  it('escalates plausible_unconfirmed to disputed when safety-critical', () => {
    expect(escalateForSafety('plausible_unconfirmed', true)).toBe('disputed');
  });

  it('leaves plausible_unconfirmed as-is when not safety-critical', () => {
    expect(escalateForSafety('plausible_unconfirmed', false)).toBe('plausible_unconfirmed');
  });

  it('leaves a real verified finding as verified even when safety-critical', () => {
    expect(escalateForSafety('verified', true)).toBe('verified');
  });

  it('leaves an already-disputed finding as disputed regardless', () => {
    expect(escalateForSafety('disputed', false)).toBe('disputed');
  });
});

describe('DatasetFactCheckerBot', () => {
  describe('checkClaim', () => {
    it('routes a genuinely verified claim without requiring human review', async () => {
      const bot = new DatasetFactCheckerBot(makeSpec());
      const result = await bot.checkClaim(input(), 'verified');
      expect(result.requiresHumanReview).toBe(false);
    });

    it('routes a real safety-critical unconfirmed claim to human review as disputed', async () => {
      const bot = new DatasetFactCheckerBot(makeSpec());
      const result = await bot.checkClaim(input({ safetyCritical: true }), 'plausible_unconfirmed');
      expect(result.tag).toBe('disputed');
      expect(result.requiresHumanReview).toBe(true);
    });

    it('signals the swarm when human review is genuinely required', async () => {
      const bot = new DatasetFactCheckerBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.checkClaim(input(), 'plausible_unconfirmed');

      expect(received).toHaveLength(1);
      unsubscribe();
    });

    it('does not signal when a claim is genuinely verified', async () => {
      const bot = new DatasetFactCheckerBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.checkClaim(input(), 'verified');

      expect(received).toHaveLength(0);
      unsubscribe();
    });

    it('blocks checking without write:fact-check-results permission', async () => {
      const bot = new DatasetFactCheckerBot(makeSpec({ permissionScope: [] }));
      await expect(bot.checkClaim(input(), 'verified')).rejects.toThrow('outside its declared permissionScope');
    });
  });
});
