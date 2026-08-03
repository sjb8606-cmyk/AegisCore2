import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { TimeKeeperBot } from '../bots/time-keeper';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'D-09',
    role: 'Test Time-Keeper used to verify dual-source drift detection.',
    triggerConditions: ['manual'],
    behaviorDescription:
      'Test-only Time-Keeper used to verify drift detection, unreachable-source handling, and Synchronous Gate classification.',
    permissionScope: ['read:system-clock'],
    hitlClassification: 'Synchronous Gate',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

describe('TimeKeeperBot', () => {
  describe('verifyTemporalIntegrity', () => {
    it('does not recommend Fortress Mode when drift is within threshold', async () => {
      const bot = new TimeKeeperBot(makeSpec());
      const result = await bot.verifyTemporalIntegrity(1_000_000_000, 1_000_000_010);

      expect(result.recommendFortressMode).toBe(false);
      expect(result.reason).toBeNull();
      expect(result.driftMs).toBe(10);
    });

    it('recommends Fortress Mode when drift exceeds the default threshold', async () => {
      const bot = new TimeKeeperBot(makeSpec());
      const result = await bot.verifyTemporalIntegrity(1_000_000_000, 1_000_000_600);

      expect(result.recommendFortressMode).toBe(true);
      expect(result.reason).toBe('drift exceeds threshold');
      expect(result.driftMs).toBe(600);
    });

    it('treats negative drift (local ahead of external) the same as positive drift', async () => {
      const bot = new TimeKeeperBot(makeSpec());
      const result = await bot.verifyTemporalIntegrity(1_000_000_600, 1_000_000_000);

      expect(result.recommendFortressMode).toBe(true);
      expect(result.driftMs).toBe(600);
    });

    it('respects a custom drift threshold', async () => {
      const bot = new TimeKeeperBot(makeSpec());
      const result = await bot.verifyTemporalIntegrity(1_000_000_000, 1_000_000_600, 1000);

      expect(result.recommendFortressMode).toBe(false);
    });

    it('treats an unreachable external source exactly as seriously as detected drift', async () => {
      const bot = new TimeKeeperBot(makeSpec());
      const result = await bot.verifyTemporalIntegrity(1_000_000_000, null);

      expect(result.recommendFortressMode).toBe(true);
      expect(result.reason).toBe('external time source unreachable');
      expect(result.driftMs).toBeNull();
    });

    it('returns a real decisionId a human can use to record a verdict via D-04', async () => {
      const bot = new TimeKeeperBot(makeSpec());
      const result = await bot.verifyTemporalIntegrity(1_000_000_000, 1_000_000_010);

      expect(typeof result.decisionId).toBe('string');
      expect(result.decisionId.length).toBeGreaterThan(0);
    });

    it('blocks verification without read:system-clock permission', async () => {
      const bot = new TimeKeeperBot(makeSpec({ permissionScope: [] }));
      await expect(bot.verifyTemporalIntegrity(1_000_000_000, 1_000_000_010)).rejects.toThrow(
        'outside its declared permissionScope',
      );
    });

    it('signals the swarm when Fortress Mode is recommended', async () => {
      const bot = new TimeKeeperBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.verifyTemporalIntegrity(1_000_000_000, null);

      expect(received).toHaveLength(1);
      unsubscribe();
    });

    it('does not signal the swarm when everything is in sync', async () => {
      const bot = new TimeKeeperBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.verifyTemporalIntegrity(1_000_000_000, 1_000_000_010);

      expect(received).toHaveLength(0);
      unsubscribe();
    });
  });

  describe('fetchExternalTime', () => {
    it('throws an honest error rather than faking a network call', async () => {
      const bot = new TimeKeeperBot(makeSpec());
      await expect(bot.fetchExternalTime()).rejects.toThrow('no network access');
    });
  });
});
