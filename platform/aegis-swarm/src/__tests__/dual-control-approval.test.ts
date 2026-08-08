import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { DualControlApprovalBot, checkDualControl } from '../employees/dual-control-approval';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'E-33',
    role: 'Test Dual-Control Approval used to verify real unique-approver enforcement.',
    triggerConditions: ['manual'],
    behaviorDescription: 'Test-only Dual-Control Approval used to verify real uniqueness logic.',
    permissionScope: ['write:approvals'],
    hitlClassification: 'Synchronous Gate',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

describe('checkDualControl (pure real unique-approver enforcement)', () => {
  it('approves with two genuinely different real approvers', () => {
    const result = checkDualControl(['alice', 'bob'], 2);
    expect(result.approved).toBe(true);
    expect(result.uniqueApproverCount).toBe(2);
  });

  it('rejects the same person "approving" twice — the critical real case', () => {
    const result = checkDualControl(['alice', 'alice'], 2);
    expect(result.approved).toBe(false);
    expect(result.uniqueApproverCount).toBe(1);
  });

  it('rejects when only one real approver has acted so far', () => {
    const result = checkDualControl(['alice'], 2);
    expect(result.approved).toBe(false);
  });

  it('respects a real, higher configured threshold', () => {
    const result = checkDualControl(['alice', 'bob'], 3);
    expect(result.approved).toBe(false);
    expect(result.uniqueApproverCount).toBe(2);
  });
});

describe('DualControlApprovalBot', () => {
  describe('checkApproval', () => {
    it('signals the swarm when approval is genuinely still pending', async () => {
      const bot = new DualControlApprovalBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.checkApproval('action-1', ['alice', 'alice']);

      expect(received).toHaveLength(1);
      unsubscribe();
    });

    it('does not signal when real dual control is genuinely satisfied', async () => {
      const bot = new DualControlApprovalBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.checkApproval('action-1', ['alice', 'bob']);

      expect(received).toHaveLength(0);
      unsubscribe();
    });

    it('blocks checking without write:approvals permission', async () => {
      const bot = new DualControlApprovalBot(makeSpec({ permissionScope: [] }));
      await expect(bot.checkApproval('action-1', ['alice', 'bob'])).rejects.toThrow(
        'outside its declared permissionScope',
      );
    });
  });
});
