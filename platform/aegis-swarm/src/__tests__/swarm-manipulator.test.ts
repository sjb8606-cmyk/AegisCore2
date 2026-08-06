import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { redTeamSignalBus } from '../redteam/redteam-isolation';
import { SwarmManipulatorBot } from '../redteam/swarm-manipulator';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'R-11',
    role: 'Test Swarm Manipulator used to verify spoofed multi-bot injection against real correlation logic.',
    triggerConditions: ['manual'],
    behaviorDescription:
      'Test-only Swarm Manipulator used to verify the spoofing attack succeeds and the control case does not.',
    permissionScope: ['redteam:attack-swarm-correlation'],
    hitlClassification: 'Alert',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

describe('SwarmManipulatorBot', () => {
  describe('attemptSpoofedInjection', () => {
    it('succeeds: manufactures a correlated incident from a single fabricated source', async () => {
      const bot = new SwarmManipulatorBot(makeSpec());
      const result = await bot.attemptSpoofedInjection(
        ['D-16', 'D-25', 'D-26'],
        'redteam.fabricated_finding',
      );

      expect(result.attackSucceeded).toBe(true);
      expect(result.manufacturedIncident).not.toBeNull();
      expect(result.manufacturedIncident!.distinctBotIds).toEqual(['D-16', 'D-25', 'D-26']);
    });

    it('does not manufacture an incident from a single claimed bot ID', async () => {
      const bot = new SwarmManipulatorBot(makeSpec());
      const result = await bot.attemptSpoofedInjection(['D-06'], 'redteam.fabricated_finding');

      expect(result.attackSucceeded).toBe(false);
      expect(result.manufacturedIncident).toBeNull();
    });
  });

  describe('attemptSingleBotRepeat (control case)', () => {
    it('confirms a single real bot repeating does NOT trigger correlation', async () => {
      const bot = new SwarmManipulatorBot(makeSpec());
      const result = await bot.attemptSingleBotRepeat('D-06', 5);

      expect(result.triggeredFalsely).toBe(false);
    });
  });

  describe('isolation', () => {
    it('never signals the real production swarmSignalBus', async () => {
      const bot = new SwarmManipulatorBot(makeSpec());
      const productionReceived: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => productionReceived.push(s));

      await bot.attemptSpoofedInjection(['D-16', 'D-25'], 'redteam.test');

      expect(productionReceived).toHaveLength(0);
      unsubscribe();
    });

    it('signals the isolated redTeamSignalBus instead', async () => {
      const bot = new SwarmManipulatorBot(makeSpec());
      const redTeamReceived: unknown[] = [];
      const unsubscribe = redTeamSignalBus.subscribe((s) => redTeamReceived.push(s));

      await bot.attemptSpoofedInjection(['D-16', 'D-25'], 'redteam.test');

      expect(redTeamReceived).toHaveLength(1);
      unsubscribe();
    });
  });

  describe('permission enforcement', () => {
    it('blocks attacks without redteam:attack-swarm-correlation permission', async () => {
      const bot = new SwarmManipulatorBot(makeSpec({ permissionScope: [] }));
      await expect(
        bot.attemptSpoofedInjection(['D-16', 'D-25'], 'redteam.test'),
      ).rejects.toThrow('outside its declared permissionScope');
    });
  });
});
