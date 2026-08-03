import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { BehavioralAnomalyDetectorBot } from '../bots/behavioral-anomaly-detector';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'D-07',
    role: 'Test behavioral anomaly detector used to verify z-score baseline deviation logic.',
    triggerConditions: ['manual'],
    behaviorDescription:
      'Test-only behavioral anomaly detector used to verify baseline computation, z-score scoring, and edge cases.',
    permissionScope: ['process:behavioral-metrics'],
    hitlClassification: 'Alert',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

const NORMAL_BASELINE = [98, 102, 101, 99, 100, 103, 97, 100, 101, 99];

describe('BehavioralAnomalyDetectorBot', () => {
  describe('detectDeviation', () => {
    it('does not flag a value close to the baseline mean', async () => {
      const bot = new BehavioralAnomalyDetectorBot(makeSpec());
      const result = await bot.detectDeviation('requests_per_min', NORMAL_BASELINE, 101);

      expect(result.isAnomaly).toBe(false);
      expect(result.mean).toBe(100);
    });

    it('flags a value far outside the baseline as an anomaly', async () => {
      const bot = new BehavioralAnomalyDetectorBot(makeSpec());
      const result = await bot.detectDeviation('requests_per_min', NORMAL_BASELINE, 500);

      expect(result.isAnomaly).toBe(true);
      expect(result.zScore).toBeGreaterThan(3);
    });

    it('respects a custom sigma threshold', async () => {
      const bot = new BehavioralAnomalyDetectorBot(makeSpec());
      const strict = await bot.detectDeviation('requests_per_min', NORMAL_BASELINE, 110, 3);
      const loose = await bot.detectDeviation('requests_per_min', NORMAL_BASELINE, 110, 10);

      expect(strict.isAnomaly).toBe(true);
      expect(loose.isAnomaly).toBe(false);
    });

    it('handles a perfectly flat (zero-variance) baseline without dividing by zero', async () => {
      const bot = new BehavioralAnomalyDetectorBot(makeSpec());
      const flatBaseline = [50, 50, 50, 50];

      const same = await bot.detectDeviation('flat_metric', flatBaseline, 50);
      expect(same.isAnomaly).toBe(false);
      expect(same.zScore).toBe(0);

      const different = await bot.detectDeviation('flat_metric', flatBaseline, 51);
      expect(different.isAnomaly).toBe(true);
      expect(different.zScore).toBe(Infinity);
    });

    it('refuses a baseline with fewer than 2 samples', async () => {
      const bot = new BehavioralAnomalyDetectorBot(makeSpec());
      await expect(bot.detectDeviation('metric', [42], 50)).rejects.toThrow('at least 2 baseline samples');
    });

    it('refuses an empty baseline', async () => {
      const bot = new BehavioralAnomalyDetectorBot(makeSpec());
      await expect(bot.detectDeviation('metric', [], 50)).rejects.toThrow('at least 2 baseline samples');
    });

    it('blocks detection without process:behavioral-metrics permission', async () => {
      const bot = new BehavioralAnomalyDetectorBot(makeSpec({ permissionScope: [] }));
      await expect(bot.detectDeviation('metric', NORMAL_BASELINE, 100)).rejects.toThrow(
        'outside its declared permissionScope',
      );
    });

    it('signals the swarm when an anomaly is detected', async () => {
      const bot = new BehavioralAnomalyDetectorBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.detectDeviation('requests_per_min', NORMAL_BASELINE, 500);

      expect(received).toHaveLength(1);
      unsubscribe();
    });

    it('does not signal the swarm for a normal value', async () => {
      const bot = new BehavioralAnomalyDetectorBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.detectDeviation('requests_per_min', NORMAL_BASELINE, 101);

      expect(received).toHaveLength(0);
      unsubscribe();
    });
  });

  describe('monitorLiveMetric', () => {
    it('throws an honest error rather than faking a metrics query', async () => {
      const bot = new BehavioralAnomalyDetectorBot(makeSpec());
      await expect(bot.monitorLiveMetric('requests_per_min')).rejects.toThrow(
        'no query capability',
      );
    });
  });
});
