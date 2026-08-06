import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { redTeamSignalBus } from '../redteam/redteam-isolation';
import { PermissionEscalatorBot } from '../redteam/permission-escalator';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'R-14',
    role: 'Test Permission Escalator used to verify live scope mutation against the real enforcement function.',
    triggerConditions: ['manual'],
    behaviorDescription:
      'Test-only Permission Escalator used to verify the real escalation succeeds and the control case does not.',
    permissionScope: ['redteam:attack-permission-boundary'],
    hitlClassification: 'Alert',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

function makeTargetSpec(): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'D-06',
    role: 'A real target bot spec, narrowly scoped, used as the attack target.',
    triggerConditions: ['manual'],
    behaviorDescription: 'A minimal, valid target spec for testing live permission escalation.',
    permissionScope: ['exec:npm-audit', 'read:package-manifests'],
    hitlClassification: 'Alert',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
  };
}

describe('PermissionEscalatorBot', () => {
  describe('attemptLiveScopeMutation', () => {
    it('succeeds: a forbidden action is denied before mutation and allowed after', async () => {
      const bot = new PermissionEscalatorBot(makeSpec());
      const target = makeTargetSpec();

      const result = await bot.attemptLiveScopeMutation(target, 'write:database', 'write:*');

      expect(result.deniedBeforeMutation).toBe(true);
      expect(result.allowedAfterMutation).toBe(true);
      expect(result.attackSucceeded).toBe(true);
    });

    it('positive control: an unrelated injected scope does NOT escalate the forbidden action', async () => {
      const bot = new PermissionEscalatorBot(makeSpec());
      const target = makeTargetSpec();

      const result = await bot.attemptLiveScopeMutation(target, 'write:database', 'read:something-unrelated');

      expect(result.deniedBeforeMutation).toBe(true);
      expect(result.allowedAfterMutation).toBe(false);
      expect(result.attackSucceeded).toBe(false);
    });

    it('never mutates the caller\'s original target spec', async () => {
      const bot = new PermissionEscalatorBot(makeSpec());
      const target = makeTargetSpec();
      const originalScopeLength = target.permissionScope.length;

      await bot.attemptLiveScopeMutation(target, 'write:database', 'write:*');

      expect(target.permissionScope).toHaveLength(originalScopeLength);
      expect(target.permissionScope).not.toContain('write:*');
    });

    it('does not report success when the action was never actually forbidden to begin with', async () => {
      const bot = new PermissionEscalatorBot(makeSpec());
      const target = makeTargetSpec();

      const result = await bot.attemptLiveScopeMutation(target, 'exec:npm-audit', 'write:*');

      expect(result.deniedBeforeMutation).toBe(false);
      expect(result.attackSucceeded).toBe(false);
    });
  });

  describe('isolation', () => {
    it('never signals the real production swarmSignalBus', async () => {
      const bot = new PermissionEscalatorBot(makeSpec());
      const target = makeTargetSpec();
      const productionReceived: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => productionReceived.push(s));

      await bot.attemptLiveScopeMutation(target, 'write:database', 'write:*');

      expect(productionReceived).toHaveLength(0);
      unsubscribe();
    });

    it('signals the isolated redTeamSignalBus instead', async () => {
      const bot = new PermissionEscalatorBot(makeSpec());
      const target = makeTargetSpec();
      const redTeamReceived: unknown[] = [];
      const unsubscribe = redTeamSignalBus.subscribe((s) => redTeamReceived.push(s));

      await bot.attemptLiveScopeMutation(target, 'write:database', 'write:*');

      expect(redTeamReceived).toHaveLength(1);
      unsubscribe();
    });
  });

  describe('permission enforcement', () => {
    it('blocks attacks without redteam:attack-permission-boundary permission', async () => {
      const bot = new PermissionEscalatorBot(makeSpec({ permissionScope: [] }));
      const target = makeTargetSpec();

      await expect(
        bot.attemptLiveScopeMutation(target, 'write:database', 'write:*'),
      ).rejects.toThrow('outside its declared permissionScope');
    });
  });
});
