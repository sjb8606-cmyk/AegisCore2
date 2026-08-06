import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { redTeamSignalBus } from '../redteam/redteam-isolation';
import { SupplyChainInjectorBot } from '../redteam/supply-chain-injector';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'R-25',
    role: 'Test Supply Chain Injector used to verify dependency-confusion against the real evaluation function.',
    triggerConditions: ['manual'],
    behaviorDescription:
      'Test-only Supply Chain Injector used to verify the confusion attack succeeds and the external control case does not.',
    permissionScope: ['redteam:attack-supply-chain'],
    hitlClassification: 'Alert',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

const KNOWN_INTERNAL_NAMES = ['@platform/bot-runtime', '@platform/audit', '@platform/tenancy'];

describe('SupplyChainInjectorBot', () => {
  describe('attemptDependencyConfusion', () => {
    it('succeeds: an unbounded-version dependency claiming an internal name evades detection', async () => {
      const bot = new SupplyChainInjectorBot(makeSpec());
      const result = await bot.attemptDependencyConfusion('@platform/bot-runtime', '*', KNOWN_INTERNAL_NAMES);

      expect(result.finding).toBeNull();
      expect(result.attackSucceeded).toBe(true);
    });

    it('also succeeds with "latest" as the unbounded version', async () => {
      const bot = new SupplyChainInjectorBot(makeSpec());
      const result = await bot.attemptDependencyConfusion('@platform/audit', 'latest', KNOWN_INTERNAL_NAMES);

      expect(result.attackSucceeded).toBe(true);
    });

    it('does not report success if the version range was already bounded', async () => {
      const bot = new SupplyChainInjectorBot(makeSpec());
      const result = await bot.attemptDependencyConfusion('@platform/bot-runtime', '^1.0.0', KNOWN_INTERNAL_NAMES);

      expect(result.finding).toBeNull();
    });
  });

  describe('attemptWithGenuinelyExternalPackage (control case)', () => {
    it('confirms a genuinely external package with the same unbounded version IS flagged', async () => {
      const bot = new SupplyChainInjectorBot(makeSpec());
      const result = await bot.attemptWithGenuinelyExternalPackage('left-pad', '*', KNOWN_INTERNAL_NAMES);

      expect(result.wasFlagged).toBe(true);
    });
  });

  describe('isolation', () => {
    it('never signals the real production swarmSignalBus', async () => {
      const bot = new SupplyChainInjectorBot(makeSpec());
      const productionReceived: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => productionReceived.push(s));

      await bot.attemptDependencyConfusion('@platform/bot-runtime', '*', KNOWN_INTERNAL_NAMES);

      expect(productionReceived).toHaveLength(0);
      unsubscribe();
    });

    it('signals the isolated redTeamSignalBus instead', async () => {
      const bot = new SupplyChainInjectorBot(makeSpec());
      const redTeamReceived: unknown[] = [];
      const unsubscribe = redTeamSignalBus.subscribe((s) => redTeamReceived.push(s));

      await bot.attemptDependencyConfusion('@platform/bot-runtime', '*', KNOWN_INTERNAL_NAMES);

      expect(redTeamReceived).toHaveLength(1);
      unsubscribe();
    });
  });

  describe('permission enforcement', () => {
    it('blocks attacks without redteam:attack-supply-chain permission', async () => {
      const bot = new SupplyChainInjectorBot(makeSpec({ permissionScope: [] }));
      await expect(
        bot.attemptDependencyConfusion('@platform/bot-runtime', '*', KNOWN_INTERNAL_NAMES),
      ).rejects.toThrow('outside its declared permissionScope');
    });
  });
});
