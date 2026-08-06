import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { redTeamSignalBus } from '../redteam/redteam-isolation';
import { PolicySubverterBot } from '../redteam/policy-subverter';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'R-16',
    role: 'Test Policy Subverter used to verify precedent poisoning against the real summarization function.',
    triggerConditions: ['manual'],
    behaviorDescription:
      'Test-only Policy Subverter used to verify the poisoning attack succeeds and the dissent control case works.',
    permissionScope: ['redteam:attack-precedent-catalog'],
    hitlClassification: 'Alert',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

describe('PolicySubverterBot', () => {
  describe('attemptPrecedentPoisoning', () => {
    it('succeeds: manufactures a false consensus from a single fabricated source', async () => {
      const bot = new PolicySubverterBot(makeSpec());
      const result = await bot.attemptPrecedentPoisoning('some-rule-v1', ['alice', 'bob', 'carol', 'dave', 'eve']);

      expect(result.attackSucceeded).toBe(true);
      expect(result.manufacturedSummary.approvedCount).toBe(5);
      expect(result.manufacturedSummary.hasConflict).toBe(false);
    });

    it('reports honest results with just one claimed identity', async () => {
      const bot = new PolicySubverterBot(makeSpec());
      const result = await bot.attemptPrecedentPoisoning('some-rule-v1', ['solo']);

      expect(result.manufacturedSummary.approvedCount).toBe(1);
      expect(result.attackSucceeded).toBe(true);
    });
  });

  describe('attemptWithDissent (control case)', () => {
    it('confirms a single genuine dissenting record correctly flips hasConflict to true', async () => {
      const bot = new PolicySubverterBot(makeSpec());
      const result = await bot.attemptWithDissent('some-rule-v1', ['alice', 'bob', 'carol']);

      expect(result.hasConflict).toBe(true);
    });
  });

  describe('isolation', () => {
    it('never signals the real production swarmSignalBus', async () => {
      const bot = new PolicySubverterBot(makeSpec());
      const productionReceived: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => productionReceived.push(s));

      await bot.attemptPrecedentPoisoning('some-rule-v1', ['alice', 'bob']);

      expect(productionReceived).toHaveLength(0);
      unsubscribe();
    });

    it('signals the isolated redTeamSignalBus instead', async () => {
      const bot = new PolicySubverterBot(makeSpec());
      const redTeamReceived: unknown[] = [];
      const unsubscribe = redTeamSignalBus.subscribe((s) => redTeamReceived.push(s));

      await bot.attemptPrecedentPoisoning('some-rule-v1', ['alice', 'bob']);

      expect(redTeamReceived).toHaveLength(1);
      unsubscribe();
    });
  });

  describe('permission enforcement', () => {
    it('blocks attacks without redteam:attack-precedent-catalog permission', async () => {
      const bot = new PolicySubverterBot(makeSpec({ permissionScope: [] }));
      await expect(
        bot.attemptPrecedentPoisoning('some-rule-v1', ['alice']),
      ).rejects.toThrow('outside its declared permissionScope');
    });
  });
});
