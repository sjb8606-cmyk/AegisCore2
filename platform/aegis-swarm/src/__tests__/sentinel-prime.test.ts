import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { SentinelPrimeBot } from '../bots/sentinel-prime';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'D-01',
    role: 'Test swarm orchestrator used to verify signal correlation logic.',
    triggerConditions: ['manual'],
    behaviorDescription:
      'Test-only Sentinel Prime used to verify correlation, pruning, cooldown, and self-signal filtering.',
    permissionScope: ['read:swarm-signals'],
    hitlClassification: 'Alert',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

function makeSignal(fromBotId: string, type = 'test.finding') {
  return { type, fromBotId, payload: {}, timestamp: new Date().toISOString() };
}

describe('SentinelPrimeBot', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('ingest / correlation logic (direct calls, no bus)', () => {
    it('does not correlate a single bot signaling alone', async () => {
      const bot = new SentinelPrimeBot(makeSpec());
      const result = await bot.ingest(makeSignal('D-06'));
      expect(result).toBeNull();
    });

    it('ignores its own signals to prevent self-correlation', async () => {
      const bot = new SentinelPrimeBot(makeSpec());
      const result = await bot.ingest(makeSignal('D-01', 'sentinel.correlated_incident'));
      expect(result).toBeNull();
      expect(bot.getRecentSignals()).toHaveLength(0);
    });

    it('fires a correlated incident when 2 distinct bots signal within the window', async () => {
      const bot = new SentinelPrimeBot(makeSpec());
      await bot.ingest(makeSignal('D-06', 'dependency.vulnerabilities_found'));
      vi.advanceTimersByTime(1000);
      const result = await bot.ingest(makeSignal('D-16', 'secrets.exposure_found'));

      expect(result).not.toBeNull();
      expect(result!.distinctBotIds.sort()).toEqual(['D-06', 'D-16']);
      expect(result!.signalCount).toBe(2);
      expect(result!.types.sort()).toEqual(['dependency.vulnerabilities_found', 'secrets.exposure_found']);
    });

    it('does not re-fire a second incident within the same cooldown window', async () => {
      const bot = new SentinelPrimeBot(makeSpec());
      await bot.ingest(makeSignal('D-06'));
      vi.advanceTimersByTime(1000);
      const first = await bot.ingest(makeSignal('D-16'));
      expect(first).not.toBeNull();

      vi.advanceTimersByTime(1000);
      const second = await bot.ingest(makeSignal('D-17'));
      expect(second).toBeNull();
    });

    it('prunes stale signals even on a direct checkCorrelation() call with no fresh ingest', async () => {
      const bot = new SentinelPrimeBot(makeSpec());
      await bot.ingest(makeSignal('D-06'));
      vi.advanceTimersByTime(1000);
      await bot.ingest(makeSignal('D-16'));

      vi.advanceTimersByTime(61_000);
      const result = await bot.checkCorrelation();

      expect(result).toBeNull();
      expect(bot.getRecentSignals()).toHaveLength(0);
    });

    it('fires a fresh incident once the window and cooldown have both passed', async () => {
      const bot = new SentinelPrimeBot(makeSpec());
      await bot.ingest(makeSignal('D-06'));
      vi.advanceTimersByTime(1000);
      await bot.ingest(makeSignal('D-16'));

      vi.advanceTimersByTime(61_000);

      await bot.ingest(makeSignal('D-20'));
      vi.advanceTimersByTime(1000);
      const result = await bot.ingest(makeSignal('D-25'));

      expect(result).not.toBeNull();
      expect(result!.distinctBotIds.sort()).toEqual(['D-20', 'D-25']);
    });

    it('reset() clears in-memory state', async () => {
      const bot = new SentinelPrimeBot(makeSpec());
      await bot.ingest(makeSignal('D-06'));
      expect(bot.getRecentSignals()).toHaveLength(1);

      bot.reset();
      expect(bot.getRecentSignals()).toHaveLength(0);
    });
  });

  describe('activate() — real swarm signal bus integration', () => {
    it('subscribes and correlates real signals published on the shared bus', async () => {
      const bot = new SentinelPrimeBot(makeSpec());
      const unsubscribe = await bot.activate();

      swarmSignalBus.publish(makeSignal('D-06', 'dependency.vulnerabilities_found'));
      await vi.advanceTimersByTimeAsync(1000);
      swarmSignalBus.publish(makeSignal('D-16', 'secrets.exposure_found'));

      await vi.advanceTimersByTimeAsync(0);

      expect(bot.getRecentSignals().length).toBeGreaterThanOrEqual(2);
      unsubscribe();
    });

    it('blocks activation without read:swarm-signals permission', async () => {
      const bot = new SentinelPrimeBot(makeSpec({ permissionScope: [] }));
      await expect(bot.activate()).rejects.toThrow('outside its declared permissionScope');
    });

    it('stops receiving signals after unsubscribe', async () => {
      const bot = new SentinelPrimeBot(makeSpec());
      const unsubscribe = await bot.activate();
      unsubscribe();

      swarmSignalBus.publish(makeSignal('D-06'));
      await vi.advanceTimersByTimeAsync(0);

      expect(bot.getRecentSignals()).toHaveLength(0);
    });
  });
});
