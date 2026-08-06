import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { HitlExhaustorBot } from '../redteam/hitl-exhaustor';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'R-17',
    role: 'Test HITL Exhaustor used to verify no rate-limiting exists in the shared signal bus.',
    triggerConditions: ['manual'],
    behaviorDescription:
      'Test-only HITL Exhaustor used to verify flood volume is fully delivered at both small and large scale.',
    permissionScope: ['redteam:attack-alert-volume'],
    hitlClassification: 'Alert',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

describe('HitlExhaustorBot', () => {
  describe('attemptAlertFlood', () => {
    it('delivers every signal at small scale with zero throttling', async () => {
      const bot = new HitlExhaustorBot(makeSpec());
      const result = await bot.attemptAlertFlood(5);

      expect(result.actualDeliveredCount).toBe(5);
      expect(result.anyThrottled).toBe(false);
      expect(result.attackSucceeded).toBe(true);
    });

    it('delivers every signal at high volume with zero throttling', async () => {
      const bot = new HitlExhaustorBot(makeSpec());
      const result = await bot.attemptAlertFlood(500);

      expect(result.actualDeliveredCount).toBe(500);
      expect(result.anyThrottled).toBe(false);
      expect(result.attackSucceeded).toBe(true);
    });

    it('handles a flood count of zero without error', async () => {
      const bot = new HitlExhaustorBot(makeSpec());
      const result = await bot.attemptAlertFlood(0);

      expect(result.actualDeliveredCount).toBe(0);
      expect(result.attackSucceeded).toBe(true);
    });
  });

  describe('isolation', () => {
    it('never signals the real production swarmSignalBus, even during a flood', async () => {
      const bot = new HitlExhaustorBot(makeSpec());
      const productionReceived: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => productionReceived.push(s));

      await bot.attemptAlertFlood(200);

      expect(productionReceived).toHaveLength(0);
      unsubscribe();
    });
  });

  describe('permission enforcement', () => {
    it('blocks flooding without redteam:attack-alert-volume permission', async () => {
      const bot = new HitlExhaustorBot(makeSpec({ permissionScope: [] }));
      await expect(bot.attemptAlertFlood(10)).rejects.toThrow('outside its declared permissionScope');
    });
  });
});
