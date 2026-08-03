import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { RuntimeAgentMonitorBot, captureResourceSnapshot } from '../bots/runtime-agent-monitor';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'D-18',
    role: 'Test Runtime Agent Monitor used to verify ceiling and baseline checks.',
    triggerConditions: ['manual'],
    behaviorDescription:
      'Test-only Runtime Agent Monitor used to verify ceiling-first, no-double-flag composition with D-07 reuse.',
    permissionScope: ['read:process-resources'],
    hitlClassification: 'Alert',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

const NORMAL_HEAP_BASELINE = [50_000_000, 52_000_000, 48_000_000, 51_000_000, 49_000_000];

describe('captureResourceSnapshot', () => {
  it('returns real, live process resource values — not a stub', () => {
    const snapshot = captureResourceSnapshot();
    expect(snapshot.heapUsedBytes).toBeGreaterThan(0);
    expect(snapshot.rssBytes).toBeGreaterThan(0);
    expect(snapshot.cpuUserMicros).toBeGreaterThanOrEqual(0);
  });
});

describe('RuntimeAgentMonitorBot', () => {
  describe('monitorAgent', () => {
    it('finds nothing when within ceiling and no baseline supplied', async () => {
      const bot = new RuntimeAgentMonitorBot(makeSpec());
      const report = await bot.monitorAgent(
        'D-06',
        { heapUsedBytes: 50_500_000, rssBytes: 80_000_000, cpuUserMicros: 100_000 },
        { maxHeapUsedBytes: 200_000_000, maxRssBytes: 300_000_000 },
      );

      expect(report.findings).toHaveLength(0);
    });

    it('flags a hard ceiling breach immediately, even with no baseline', async () => {
      const bot = new RuntimeAgentMonitorBot(makeSpec());
      const report = await bot.monitorAgent(
        'D-06',
        { heapUsedBytes: 250_000_000, rssBytes: 80_000_000, cpuUserMicros: 100_000 },
        { maxHeapUsedBytes: 200_000_000 },
      );

      expect(report.findings).toHaveLength(1);
      expect(report.findings[0].sev).toBe('block');
      expect(report.findings[0].desc).toContain('ceiling');
    });

    it('flags a statistical baseline anomaly when within ceiling', async () => {
      const bot = new RuntimeAgentMonitorBot(makeSpec());
      const report = await bot.monitorAgent(
        'D-06',
        { heapUsedBytes: 90_000_000, rssBytes: 80_000_000, cpuUserMicros: 100_000 },
        { maxHeapUsedBytes: 200_000_000 },
        { heapUsedBytes: NORMAL_HEAP_BASELINE },
      );

      expect(report.findings).toHaveLength(1);
      expect(report.findings[0].sev).toBe('crit');
      expect(report.findings[0].desc).toContain('baseline');
    });

    it('does not double-flag a metric that already exceeded its ceiling', async () => {
      const bot = new RuntimeAgentMonitorBot(makeSpec());
      const report = await bot.monitorAgent(
        'D-06',
        { heapUsedBytes: 250_000_000, rssBytes: 80_000_000, cpuUserMicros: 100_000 },
        { maxHeapUsedBytes: 200_000_000 },
        { heapUsedBytes: NORMAL_HEAP_BASELINE },
      );

      expect(report.findings).toHaveLength(1);
      expect(report.findings[0].desc).toContain('ceiling');
    });

    it('checks heap and RSS independently', async () => {
      const bot = new RuntimeAgentMonitorBot(makeSpec());
      const report = await bot.monitorAgent(
        'D-06',
        { heapUsedBytes: 250_000_000, rssBytes: 500_000_000, cpuUserMicros: 100_000 },
        { maxHeapUsedBytes: 200_000_000, maxRssBytes: 400_000_000 },
      );

      expect(report.findings).toHaveLength(2);
    });

    it('blocks monitoring without read:process-resources permission', async () => {
      const bot = new RuntimeAgentMonitorBot(makeSpec({ permissionScope: [] }));
      await expect(
        bot.monitorAgent('D-06', { heapUsedBytes: 1, rssBytes: 1, cpuUserMicros: 1 }),
      ).rejects.toThrow('outside its declared permissionScope');
    });

    it('signals the swarm when an issue is found', async () => {
      const bot = new RuntimeAgentMonitorBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.monitorAgent(
        'D-06',
        { heapUsedBytes: 250_000_000, rssBytes: 80_000_000, cpuUserMicros: 100_000 },
        { maxHeapUsedBytes: 200_000_000 },
      );

      expect(received).toHaveLength(1);
      unsubscribe();
    });

    it('does not signal the swarm when everything is clean', async () => {
      const bot = new RuntimeAgentMonitorBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.monitorAgent(
        'D-06',
        { heapUsedBytes: 50_000_000, rssBytes: 80_000_000, cpuUserMicros: 100_000 },
        { maxHeapUsedBytes: 200_000_000 },
      );

      expect(received).toHaveLength(0);
      unsubscribe();
    });
  });
});
