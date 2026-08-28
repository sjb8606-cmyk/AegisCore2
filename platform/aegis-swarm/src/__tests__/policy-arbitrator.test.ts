vi.mock('../../../bot-runtime/src/decision-store', () => ({
  saveDecision: vi.fn().mockResolvedValue(undefined),
  getDecision: vi.fn(),
  updateDecisionStatus: vi.fn(),
  listDecisionsByRulesHash: vi.fn(),
}));

import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import {
  getDecision,
  updateDecisionStatus,
  listDecisionsByRulesHash,
} from '../../../bot-runtime/src/decision-store';
import { PolicyArbitratorBot } from '../bots/policy-arbitrator';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'D-04',
    role: 'Test Policy Arbitrator used to verify verdict recording and precedent lookup.',
    triggerConditions: ['manual'],
    behaviorDescription:
      'Test-only Policy Arbitrator used to verify guarded verdict transitions and precedent/conflict detection.',
    permissionScope: ['read:decision-history', 'write:decision-verdicts'],
    hitlClassification: 'Alert',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

describe('PolicyArbitratorBot', () => {
  const mockGetDecision = getDecision as vi.Mock;
  const mockUpdateDecisionStatus = updateDecisionStatus as vi.Mock;
  const mockListDecisionsByRulesHash = listDecisionsByRulesHash as vi.Mock;

  beforeEach(() => {
    mockGetDecision.mockReset();
    mockUpdateDecisionStatus.mockReset();
    mockListDecisionsByRulesHash.mockReset();
  });

  describe('recordVerdict', () => {
    it('refuses when the decision does not exist', async () => {
      mockGetDecision.mockResolvedValue(null);
      const bot = new PolicyArbitratorBot(makeSpec());

      await expect(bot.recordVerdict('missing-id', 'approved', 'shawn')).rejects.toThrow(
        'No decision found',
      );
      expect(mockUpdateDecisionStatus).not.toHaveBeenCalled();
    });

    it('refuses when the decision is not currently pending_approval', async () => {
      mockGetDecision.mockResolvedValue({
        id: 'd-1',
        botId: 'D-17',
        status: 'logged',
        input: {},
        output: {},
        rulesHash: 'v1',
        timestamp: new Date().toISOString(),
      });
      const bot = new PolicyArbitratorBot(makeSpec());

      await expect(bot.recordVerdict('d-1', 'approved', 'shawn')).rejects.toThrow(
        'not awaiting approval',
      );
      expect(mockUpdateDecisionStatus).not.toHaveBeenCalled();
    });

    it('records an approved verdict for a genuinely pending decision', async () => {
      mockGetDecision.mockResolvedValue({
        id: 'd-1',
        botId: 'D-17',
        status: 'pending_approval',
        input: {},
        output: {},
        rulesHash: 'v1',
        timestamp: new Date().toISOString(),
      });
      mockUpdateDecisionStatus.mockResolvedValue(true);
      const bot = new PolicyArbitratorBot(makeSpec());

      const result = await bot.recordVerdict('d-1', 'approved', 'shawn');

      expect(result.recorded).toBe(true);
      expect(result.verdict).toBe('approved');
      expect(mockUpdateDecisionStatus).toHaveBeenCalledWith('d-1', 'approved');
    });

    it('records a rejected verdict for a genuinely pending decision', async () => {
      mockGetDecision.mockResolvedValue({
        id: 'd-2',
        botId: 'D-17',
        status: 'pending_approval',
        input: {},
        output: {},
        rulesHash: 'v1',
        timestamp: new Date().toISOString(),
      });
      mockUpdateDecisionStatus.mockResolvedValue(true);
      const bot = new PolicyArbitratorBot(makeSpec());

      const result = await bot.recordVerdict('d-2', 'rejected', 'shawn');
      expect(result.verdict).toBe('rejected');
    });

    it('blocks recording without write:decision-verdicts permission', async () => {
      const bot = new PolicyArbitratorBot(makeSpec({ permissionScope: ['read:decision-history'] }));
      await expect(bot.recordVerdict('d-1', 'approved', 'shawn')).rejects.toThrow(
        'outside its declared permissionScope',
      );
      expect(mockGetDecision).not.toHaveBeenCalled();
    });
  });

  describe('findPrecedent', () => {
    it('reports no precedent when nothing has been decided for this rule yet', async () => {
      mockListDecisionsByRulesHash.mockResolvedValue([]);
      const bot = new PolicyArbitratorBot(makeSpec());

      const summary = await bot.findPrecedent('some-rules-hash');

      expect(summary.hasPrecedent).toBe(false);
      expect(summary.hasConflict).toBe(false);
      expect(summary.mostRecentVerdict).toBeNull();
    });

    it('reports precedent with no conflict when only approvals exist', async () => {
      mockListDecisionsByRulesHash.mockResolvedValue([
        { id: '1', botId: 'D-17', status: 'approved', input: {}, output: {}, rulesHash: 'v1', timestamp: new Date().toISOString() },
        { id: '2', botId: 'D-17', status: 'approved', input: {}, output: {}, rulesHash: 'v1', timestamp: new Date().toISOString() },
      ]);
      const bot = new PolicyArbitratorBot(makeSpec());

      const summary = await bot.findPrecedent('v1');

      expect(summary.hasPrecedent).toBe(true);
      expect(summary.approvedCount).toBe(2);
      expect(summary.rejectedCount).toBe(0);
      expect(summary.hasConflict).toBe(false);
      expect(summary.mostRecentVerdict).toBe('approved');
    });

    it('detects a genuine conflict when both approvals and rejections exist for the same rule', async () => {
      mockListDecisionsByRulesHash.mockResolvedValue([
        { id: '1', botId: 'D-17', status: 'rejected', input: {}, output: {}, rulesHash: 'v1', timestamp: new Date().toISOString() },
        { id: '2', botId: 'D-17', status: 'approved', input: {}, output: {}, rulesHash: 'v1', timestamp: new Date().toISOString() },
      ]);
      const bot = new PolicyArbitratorBot(makeSpec());

      const summary = await bot.findPrecedent('v1');

      expect(summary.hasConflict).toBe(true);
      expect(summary.approvedCount).toBe(1);
      expect(summary.rejectedCount).toBe(1);
    });

    it('signals the swarm when a conflict is detected', async () => {
      mockListDecisionsByRulesHash.mockResolvedValue([
        { id: '1', botId: 'D-17', status: 'rejected', input: {}, output: {}, rulesHash: 'v1', timestamp: new Date().toISOString() },
        { id: '2', botId: 'D-17', status: 'approved', input: {}, output: {}, rulesHash: 'v1', timestamp: new Date().toISOString() },
      ]);
      const bot = new PolicyArbitratorBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((signal) => received.push(signal));

      await bot.findPrecedent('v1');

      expect(received).toHaveLength(1);
      unsubscribe();
    });

    it('does not signal the swarm when there is no conflict', async () => {
      mockListDecisionsByRulesHash.mockResolvedValue([
        { id: '1', botId: 'D-17', status: 'approved', input: {}, output: {}, rulesHash: 'v1', timestamp: new Date().toISOString() },
      ]);
      const bot = new PolicyArbitratorBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((signal) => received.push(signal));

      await bot.findPrecedent('v1');

      expect(received).toHaveLength(0);
      unsubscribe();
    });

    it('blocks lookup without read:decision-history permission', async () => {
      const bot = new PolicyArbitratorBot(makeSpec({ permissionScope: ['write:decision-verdicts'] }));
      await expect(bot.findPrecedent('v1')).rejects.toThrow('outside its declared permissionScope');
      expect(mockListDecisionsByRulesHash).not.toHaveBeenCalled();
    });
  });
});
