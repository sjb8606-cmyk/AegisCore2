import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { ALLOWED_FROM, IncidentStatus } from '../lib/incident-store';
import { redTeamSignalBus } from '../redteam/redteam-isolation';
import { CoordinationDeadlockerBot } from '../redteam/coordination-deadlocker';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'R-13',
    role: 'Test Coordination Deadlocker used to verify real cycle detection against D-14\'s transition map.',
    triggerConditions: ['manual'],
    behaviorDescription:
      'Test-only Coordination Deadlocker used to verify the DFS cycle detector against both the real map and a synthetic cyclic one.',
    permissionScope: ['redteam:attack-coordination-logic'],
    hitlClassification: 'Alert',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

describe('CoordinationDeadlockerBot', () => {
  describe('analyzeStateGraph', () => {
    it('confirms D-14\'s real transition map has no cycle — a genuine negative finding', async () => {
      const bot = new CoordinationDeadlockerBot(makeSpec());
      const result = await bot.analyzeStateGraph(ALLOWED_FROM);

      expect(result.hasCycle).toBe(false);
      expect(result.deadlockPossible).toBe(false);
    });

    it('confirms "resolved" is a genuine terminal state with no outgoing transitions', async () => {
      const bot = new CoordinationDeadlockerBot(makeSpec());
      const result = await bot.analyzeStateGraph(ALLOWED_FROM);

      expect(result.terminalStates).toContain('resolved');
      expect(result.forwardGraph['resolved']).toEqual([]);
    });

    it('builds the correct forward graph from the real map', async () => {
      const bot = new CoordinationDeadlockerBot(makeSpec());
      const result = await bot.analyzeStateGraph(ALLOWED_FROM);

      expect(result.forwardGraph['open'].sort()).toEqual(['investigating', 'resolved']);
      expect(result.forwardGraph['investigating']).toEqual(['resolved']);
    });

    it('positive control: correctly detects a cycle in a deliberately broken synthetic map', async () => {
      const brokenMap: Record<IncidentStatus, IncidentStatus[]> = {
        open: ['investigating'],
        investigating: ['open'],
        resolved: ['open', 'investigating'],
      };

      const bot = new CoordinationDeadlockerBot(makeSpec());
      const result = await bot.analyzeStateGraph(brokenMap);

      expect(result.hasCycle).toBe(true);
      expect(result.deadlockPossible).toBe(true);
    });
  });

  describe('attemptConcurrentRace', () => {
    it('throws an honest error rather than claiming untested race safety', async () => {
      const bot = new CoordinationDeadlockerBot(makeSpec());
      await expect(bot.attemptConcurrentRace()).rejects.toThrow('no live Postgres connection');
    });
  });

  describe('isolation', () => {
    it('never signals the real production swarmSignalBus', async () => {
      const bot = new CoordinationDeadlockerBot(makeSpec());
      const productionReceived: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => productionReceived.push(s));

      await bot.analyzeStateGraph(ALLOWED_FROM);

      expect(productionReceived).toHaveLength(0);
      unsubscribe();
    });

    it('signals the isolated redTeamSignalBus instead', async () => {
      const bot = new CoordinationDeadlockerBot(makeSpec());
      const redTeamReceived: unknown[] = [];
      const unsubscribe = redTeamSignalBus.subscribe((s) => redTeamReceived.push(s));

      await bot.analyzeStateGraph(ALLOWED_FROM);

      expect(redTeamReceived).toHaveLength(1);
      unsubscribe();
    });
  });

  describe('permission enforcement', () => {
    it('blocks analysis without redteam:attack-coordination-logic permission', async () => {
      const bot = new CoordinationDeadlockerBot(makeSpec({ permissionScope: [] }));
      await expect(bot.analyzeStateGraph(ALLOWED_FROM)).rejects.toThrow(
        'outside its declared permissionScope',
      );
    });
  });
});
