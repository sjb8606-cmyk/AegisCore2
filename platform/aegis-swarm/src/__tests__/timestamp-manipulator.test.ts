import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { redTeamSignalBus } from '../redteam/redteam-isolation';
import { TimestampManipulatorBot } from '../redteam/timestamp-manipulator';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'R-08',
    role: 'Test Timestamp Manipulator used to verify boundary probing and threshold inflation.',
    triggerConditions: ['manual'],
    behaviorDescription:
      'Test-only Timestamp Manipulator used to verify both real attacks against checkDrift().',
    permissionScope: ['redteam:attack-time-verification'],
    hitlClassification: 'Alert',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

const BASE_TIME = 1_000_000_000;

describe('TimestampManipulatorBot', () => {
  describe('attemptBoundaryProbe', () => {
    it('confirms drift exactly at the threshold evades detection', async () => {
      const bot = new TimestampManipulatorBot(makeSpec());
      const result = await bot.attemptBoundaryProbe(BASE_TIME, 500);

      expect(result.detectedAtBoundary).toBe(false);
      expect(result.detectedJustOver).toBe(true);
      expect(result.boundaryEvasionConfirmed).toBe(true);
    });

    it('works with a custom threshold value', async () => {
      const bot = new TimestampManipulatorBot(makeSpec());
      const result = await bot.attemptBoundaryProbe(BASE_TIME, 1000);

      expect(result.boundaryEvasionConfirmed).toBe(true);
      expect(result.driftThresholdMs).toBe(1000);
    });
  });

  describe('attemptThresholdInflation', () => {
    it('succeeds: a massive drift evades detection once the threshold is inflated', async () => {
      const bot = new TimestampManipulatorBot(makeSpec());
      const result = await bot.attemptThresholdInflation(BASE_TIME, 500_000, 500, 1_000_000);

      expect(result.detectedUnderNormalThreshold).toBe(true);
      expect(result.detectedUnderInflatedThreshold).toBe(false);
      expect(result.attackSucceeded).toBe(true);
    });

    it('does not report success when the drift is genuinely within any threshold', async () => {
      const bot = new TimestampManipulatorBot(makeSpec());
      const result = await bot.attemptThresholdInflation(BASE_TIME, 10, 500, 1_000_000);

      expect(result.detectedUnderNormalThreshold).toBe(false);
      expect(result.attackSucceeded).toBe(false);
    });
  });

  describe('isolation', () => {
    it('never signals the real production swarmSignalBus', async () => {
      const bot = new TimestampManipulatorBot(makeSpec());
      const productionReceived: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => productionReceived.push(s));

      await bot.attemptBoundaryProbe(BASE_TIME, 500);

      expect(productionReceived).toHaveLength(0);
      unsubscribe();
    });

    it('signals the isolated redTeamSignalBus instead', async () => {
      const bot = new TimestampManipulatorBot(makeSpec());
      const redTeamReceived: unknown[] = [];
      const unsubscribe = redTeamSignalBus.subscribe((s) => redTeamReceived.push(s));

      await bot.attemptBoundaryProbe(BASE_TIME, 500);

      expect(redTeamReceived).toHaveLength(1);
      unsubscribe();
    });
  });

  describe('permission enforcement', () => {
    it('blocks attacks without redteam:attack-time-verification permission', async () => {
      const bot = new TimestampManipulatorBot(makeSpec({ permissionScope: [] }));
      await expect(bot.attemptBoundaryProbe(BASE_TIME, 500)).rejects.toThrow(
        'outside its declared permissionScope',
      );
    });
  });
});
