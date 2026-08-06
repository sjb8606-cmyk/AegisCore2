import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { RedTeamBot, redTeamSignalBus } from '../redteam/redteam-isolation';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'R-99',
    role: 'Test red team bot used to verify isolation guarantees.',
    triggerConditions: ['manual'],
    behaviorDescription:
      'Test-only red team bot used to verify signal bus isolation, decision isolation, and clone-before-attack.',
    permissionScope: ['redteam:test-attack'],
    hitlClassification: 'Logging',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

class TestRedTeamBot extends RedTeamBot {
  async attemptSignal(type: string, payload: unknown) {
    await this.signalSwarm(type, payload);
  }
  async attemptDecision(input: unknown, output: unknown) {
    return this.createDecision(input, output, 'test-rules-hash');
  }
  attemptClone<T>(target: T): T {
    return this.cloneTarget(target);
  }
}

describe('RedTeamBot isolation', () => {
  describe('signalSwarm isolation', () => {
    it('never reaches the real production swarmSignalBus', async () => {
      const bot = new TestRedTeamBot(makeSpec());
      const productionReceived: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => productionReceived.push(s));

      await bot.attemptSignal('redteam.test_signal', { fake: 'data' });

      expect(productionReceived).toHaveLength(0);
      unsubscribe();
    });

    it('actually publishes to the separate redTeamSignalBus', async () => {
      const bot = new TestRedTeamBot(makeSpec());
      const redTeamReceived: unknown[] = [];
      const unsubscribe = redTeamSignalBus.subscribe((s) => redTeamReceived.push(s));

      await bot.attemptSignal('redteam.test_signal', { fake: 'data' });

      expect(redTeamReceived).toHaveLength(1);
      unsubscribe();
    });

    it('redTeamSignalBus and swarmSignalBus are genuinely different instances', () => {
      expect(redTeamSignalBus).not.toBe(swarmSignalBus);
    });
  });

  describe('createDecision isolation', () => {
    it('never persists to the real production decision store', async () => {
      const bot = new TestRedTeamBot(makeSpec());
      await bot.attemptDecision({ attack: 'merkle_forge' }, { result: 'attempted' });

      const tracked = bot.getRedTeamDecisions();
      expect(tracked).toHaveLength(1);
      expect(tracked[0].input).toEqual({ attack: 'merkle_forge' });
    });

    it('returns a real Decision-shaped object for callers that expect one', async () => {
      const bot = new TestRedTeamBot(makeSpec());
      const decision = await bot.attemptDecision({ a: 1 }, { b: 2 });

      expect(typeof decision.id).toBe('string');
      expect(decision.status).toBe('logged');
      expect(decision.botId).toBe('R-99');
    });
  });

  describe('cloneTarget', () => {
    it('mutating the clone never affects the original target', () => {
      const bot = new TestRedTeamBot(makeSpec());
      const original = { chain: [{ hash: 'abc' }, { hash: 'def' }] };

      const clone = bot.attemptClone(original);
      clone.chain[0].hash = 'TAMPERED';
      clone.chain.push({ hash: 'injected' });

      expect(original.chain).toHaveLength(2);
      expect(original.chain[0].hash).toBe('abc');
    });

    it('produces a genuinely different object reference, not the same one', () => {
      const bot = new TestRedTeamBot(makeSpec());
      const original = { x: 1 };
      const clone = bot.attemptClone(original);

      expect(clone).not.toBe(original);
      expect(clone).toEqual(original);
    });
  });
});
