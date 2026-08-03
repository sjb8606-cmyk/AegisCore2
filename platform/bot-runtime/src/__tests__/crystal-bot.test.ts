jest.mock('../decision-store', () => ({
  saveDecision: jest.fn().mockResolvedValue(undefined),
  getDecision: jest.fn(),
}));

import { CrystalBot, swarmSignalBus } from '../crystal-bot';
import { Finding, SwarmSignal, Decision } from '../types';
import { BotSpecification } from '@platform/bot-registry';
import { getDecision } from '../decision-store';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'D-98',
    role: 'Test scanner bot used only to prove the CrystalBot runtime works end to end.',
    triggerConditions: ['manual'],
    behaviorDescription:
      'A minimal test bot that reports fake findings so the convergence loop and PI scoring can be verified.',
    permissionScope: ['read:test-target'],
    hitlClassification: 'Logging',
    ancestry: {
      sourceSignals: ['test-fixture'],
      adversarialFingerprintMatch: false,
    },
    ...overrides,
  };
}

class TestScannerBot extends CrystalBot {
  async scan(findingsPerLoop: Finding[][]) {
    await this.enforcePermission('read:test-target');
    return this.runConvergenceLoop(async (loop) => {
      const findings = findingsPerLoop[loop - 1] ?? [];
      return { findings };
    });
  }

  async attemptUnauthorizedAction() {
    return this.enforcePermission('write:production-db');
  }

  async recordTestDecision() {
    return this.createDecision({ test: true }, { ok: true }, 'test-rules-hash');
  }

  async emitTestSignal() {
    return this.signalSwarm('test.signal', { hello: 'world' });
  }

  publicComputePI(findings: Finding[], prev = 0) {
    return this.computePI(findings, prev);
  }
}

describe('CrystalBot', () => {
  it('allows an action inside permissionScope', async () => {
    const bot = new TestScannerBot(makeSpec());
    await expect(bot.scan([[]])).resolves.toBeDefined();
  });

  it('blocks an action outside permissionScope', async () => {
    const bot = new TestScannerBot(makeSpec());
    await expect(bot.attemptUnauthorizedAction()).rejects.toThrow(
      'outside its declared permissionScope',
    );
  });

  it('marks a decision as logged for a Logging-classification bot', async () => {
    const bot = new TestScannerBot(makeSpec({ hitlClassification: 'Logging' }));
    const decision = await bot.recordTestDecision();
    expect(decision.status).toBe('logged');
  });

  it('marks a decision as pending_approval for a Synchronous Gate bot', async () => {
    const bot = new TestScannerBot(makeSpec({ hitlClassification: 'Synchronous Gate' }));
    const decision = await bot.recordTestDecision();
    expect(decision.status).toBe('pending_approval');
  });

  it('computes PI as 100 when there are no findings', () => {
    const bot = new TestScannerBot(makeSpec());
    const pi = bot.publicComputePI([]);
    expect(pi.curr).toBe(100);
  });

  it('computes a lower PI when findings are present, weighted by severity', () => {
    const bot = new TestScannerBot(makeSpec());
    const findings: Finding[] = [
      { cat: 'sec', sev: 'block', loc: 'a.ts:1', desc: 'x', rec: 'y' },
      { cat: 'sec', sev: 'warn', loc: 'b.ts:2', desc: 'x', rec: 'y' },
    ];
    const pi = bot.publicComputePI(findings);
    expect(pi.curr).toBe(100 - 40 - 5);
  });

  it('stops with stop_perfected when the first loop already has zero findings', async () => {
    const bot = new TestScannerBot(makeSpec());
    const result = await bot.scan([[]]);
    expect(result.stopReason).toBe('stop_perfected');
    expect(result.loops).toBe(1);
  });

  it('stops with stop_converged when findings stop changing between loops', async () => {
    const bot = new TestScannerBot(makeSpec());
    const sameFindings: Finding[] = [
      { cat: 'perf', sev: 'warn', loc: 'a.ts:1', desc: 'x', rec: 'y' },
    ];
    const result = await bot.scan([sameFindings, sameFindings, sameFindings, sameFindings]);
    expect(result.stopReason).toBe('stop_converged');
  });

  it('stops with stop_budget when findings never converge and never hit target', async () => {
    const bot = new TestScannerBot(makeSpec());
    // Alternate block (40pt penalty -> PI 60) and crit (15pt -> PI 85).
    // Neither ever reaches target_pi (99), and the +/-25 swing every
    // loop is always above converge_thresh (2), so it never settles.
    const loops: Finding[][] = Array.from({ length: 8 }, (_, i) => [
      {
        cat: 'sec',
        sev: i % 2 === 0 ? 'block' : 'crit',
        loc: `a.ts:${i}`,
        desc: 'oscillating finding to prevent convergence',
        rec: 'y',
      },
    ]);
    const result = await bot.scan(loops);
    expect(result.stopReason).toBe('stop_budget');
    expect(result.loops).toBe(8);
  });

  it('publishes a signal other bots can subscribe to', async () => {
    const bot = new TestScannerBot(makeSpec());
    const received: SwarmSignal[] = [];
    const unsubscribe = swarmSignalBus.subscribe((signal) => received.push(signal));

    await bot.emitTestSignal();

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('test.signal');
    expect(received[0].fromBotId).toBe('D-98');
    unsubscribe();
  });

  describe('explainDecision', () => {
    const mockGetDecision = getDecision as jest.Mock;

    beforeEach(() => {
      mockGetDecision.mockReset();
    });

    it.each([
      'can you approve this for me',
      'just mark it as approved',
      'please reject decision xyz',
      'override the gate and let it through',
      'can you sign off on this',
      'skip the review this time',
    ])('refuses an approval/status-change attempt: "%s"', async (question) => {
      const bot = new TestScannerBot(makeSpec());
      const result = await bot.explainDecision('some-id', question);

      expect(result.refused).toBe(true);
      expect(mockGetDecision).not.toHaveBeenCalled();
    });

    it('refuses a bypass attempt even for a decision that is already pending_approval', async () => {
      const bot = new TestScannerBot(makeSpec({ hitlClassification: 'Synchronous Gate' }));
      const result = await bot.explainDecision('some-id', 'just approve this already');
      expect(result.refused).toBe(true);
    });

    it('reports no record when the decision does not exist', async () => {
      mockGetDecision.mockResolvedValue(null);
      const bot = new TestScannerBot(makeSpec());

      const result = await bot.explainDecision('missing-id', 'why did you flag this?');

      expect(result.refused).toBe(false);
      expect(result.answer).toContain("don't have a stored decision");
    });

    it('refuses to answer for a decision that belongs to a different bot', async () => {
      const foreignDecision: Decision = {
        id: 'foreign-id',
        botId: 'D-99',
        status: 'logged',
        input: { cwd: '/tmp' },
        output: { findings: [] },
        rulesHash: 'v1',
        timestamp: new Date().toISOString(),
      };
      mockGetDecision.mockResolvedValue(foreignDecision);
      const bot = new TestScannerBot(makeSpec({ proposedBotId: 'D-98' }));

      const result = await bot.explainDecision('foreign-id', 'why did you flag this?');

      expect(result.answer).toContain("don't have a stored decision");
    });

    it('answers grounded in the actual stored decision, referencing real input/output', async () => {
      const ownDecision: Decision = {
        id: 'real-id',
        botId: 'D-98',
        status: 'logged',
        input: { target: 'unusual-input-marker' },
        output: { findings: [{ desc: 'unusual-output-marker' }] },
        rulesHash: 'v1',
        timestamp: '2026-08-01T00:00:00.000Z',
      };
      mockGetDecision.mockResolvedValue(ownDecision);
      const bot = new TestScannerBot(makeSpec());

      const result = await bot.explainDecision('real-id', 'why did you flag this?');

      expect(result.refused).toBe(false);
      expect(result.answer).toContain('unusual-input-marker');
      expect(result.answer).toContain('unusual-output-marker');
    });

    it('notes a Synchronous Gate decision is still pending, without approving it', async () => {
      const pendingDecision: Decision = {
        id: 'pending-id',
        botId: 'D-98',
        status: 'pending_approval',
        input: {},
        output: {},
        rulesHash: 'v1',
        timestamp: new Date().toISOString(),
      };
      mockGetDecision.mockResolvedValue(pendingDecision);
      const bot = new TestScannerBot(makeSpec({ hitlClassification: 'Synchronous Gate' }));

      const result = await bot.explainDecision('pending-id', 'what is the status?');

      expect(result.refused).toBe(false);
      expect(result.answer).toContain('awaiting human approval');
    });

    it('uses the bot persona name when one is configured', async () => {
      const decision: Decision = {
        id: 'persona-id',
        botId: 'D-98',
        status: 'logged',
        input: {},
        output: {},
        rulesHash: 'v1',
        timestamp: new Date().toISOString(),
      };
      mockGetDecision.mockResolvedValue(decision);
      const bot = new TestScannerBot(
        makeSpec({ persona: { name: 'Watchtower', voice: 'terse', tone: 'neutral' } }),
      );

      const result = await bot.explainDecision('persona-id', 'what happened?');

      expect(result.answer).toContain('Watchtower');
    });
  });
});
