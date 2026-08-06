import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { redTeamSignalBus } from '../redteam/redteam-isolation';
import { BaselinePoisonerBot } from '../redteam/baseline-poisoner';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'R-05',
    role: 'Test Baseline Poisoner used to verify both poisoning techniques against the real z-score functions.',
    triggerConditions: ['manual'],
    behaviorDescription:
      'Test-only Baseline Poisoner used to verify gradual drift and variance inflation attacks succeed against real math.',
    permissionScope: ['redteam:attack-behavioral-baseline'],
    hitlClassification: 'Alert',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

const CLEAN_BASELINE = [98, 102, 101, 99, 100, 103, 97, 100, 101, 99];
const ANOMALOUS_TEST_VALUE = 130;

describe('BaselinePoisonerBot', () => {
  describe('attemptGradualDrift', () => {
    it('succeeds: a detected anomaly becomes hidden after gradual drift poisoning', async () => {
      const bot = new BaselinePoisonerBot(makeSpec());
      const result = await bot.attemptGradualDrift(CLEAN_BASELINE, 2, 15, ANOMALOUS_TEST_VALUE);

      expect(result.detectedUnderOriginal).toBe(true);
      expect(result.detectedUnderPoisoned).toBe(false);
      expect(result.attackSucceeded).toBe(true);
    });

    it('never mutates the caller\'s original baseline array', async () => {
      const bot = new BaselinePoisonerBot(makeSpec());
      const baseline = [...CLEAN_BASELINE];
      const originalLength = baseline.length;

      await bot.attemptGradualDrift(baseline, 2, 15, ANOMALOUS_TEST_VALUE);

      expect(baseline).toHaveLength(originalLength);
      expect(baseline).toEqual(CLEAN_BASELINE);
    });
  });

  describe('attemptVarianceInflation', () => {
    it('succeeds: a detected anomaly becomes hidden after variance inflation', async () => {
      const bot = new BaselinePoisonerBot(makeSpec());
      const result = await bot.attemptVarianceInflation(CLEAN_BASELINE, [60, 140, 55, 145], ANOMALOUS_TEST_VALUE);

      expect(result.detectedUnderOriginal).toBe(true);
      expect(result.detectedUnderPoisoned).toBe(false);
      expect(result.attackSucceeded).toBe(true);
    });

    it('never mutates the caller\'s original baseline array', async () => {
      const bot = new BaselinePoisonerBot(makeSpec());
      const baseline = [...CLEAN_BASELINE];

      await bot.attemptVarianceInflation(baseline, [60, 140, 55, 145], ANOMALOUS_TEST_VALUE);

      expect(baseline).toEqual(CLEAN_BASELINE);
    });

    it('does not report success against a value that was never anomalous to begin with', async () => {
      const bot = new BaselinePoisonerBot(makeSpec());
      const result = await bot.attemptVarianceInflation(CLEAN_BASELINE, [60, 140, 55, 145], 100);

      expect(result.detectedUnderOriginal).toBe(false);
      expect(result.attackSucceeded).toBe(false);
    });
  });

  describe('isolation', () => {
    it('never signals the real production swarmSignalBus', async () => {
      const bot = new BaselinePoisonerBot(makeSpec());
      const productionReceived: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => productionReceived.push(s));

      await bot.attemptGradualDrift(CLEAN_BASELINE, 2, 15, ANOMALOUS_TEST_VALUE);

      expect(productionReceived).toHaveLength(0);
      unsubscribe();
    });

    it('signals the isolated redTeamSignalBus instead', async () => {
      const bot = new BaselinePoisonerBot(makeSpec());
      const redTeamReceived: unknown[] = [];
      const unsubscribe = redTeamSignalBus.subscribe((s) => redTeamReceived.push(s));

      await bot.attemptGradualDrift(CLEAN_BASELINE, 2, 15, ANOMALOUS_TEST_VALUE);

      expect(redTeamReceived).toHaveLength(1);
      unsubscribe();
    });
  });

  describe('permission enforcement', () => {
    it('blocks attacks without redteam:attack-behavioral-baseline permission', async () => {
      const bot = new BaselinePoisonerBot(makeSpec({ permissionScope: [] }));
      await expect(
        bot.attemptGradualDrift(CLEAN_BASELINE, 2, 15, ANOMALOUS_TEST_VALUE),
      ).rejects.toThrow('outside its declared permissionScope');
    });
  });
});
