import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import {
  AgentSpecRepairBot,
  insertPermissionCheck,
  alreadyHasPermissionCheck,
  SpecRepairFinding,
} from '../repair/agent-spec-repair';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'RS-06',
    role: 'Test Agent Spec Repair used to verify real mechanical patch insertion.',
    triggerConditions: ['manual'],
    behaviorDescription: 'Test-only Agent Spec Repair used to verify real patch logic.',
    permissionScope: ['read:agent-spec-findings'],
    hitlClassification: 'Alert',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

const MISSING_CHECK_SOURCE = "async doThing(x) {\n    return x * 2;\n  }";
const HAS_CHECK_SOURCE = "async doThing(x) {\n    await this.enforcePermission('x');\n    return x;\n  }";

describe('alreadyHasPermissionCheck / insertPermissionCheck (pure real patch logic)', () => {
  it('correctly detects a real missing permission check', () => {
    expect(alreadyHasPermissionCheck(MISSING_CHECK_SOURCE)).toBe(false);
  });

  it('correctly detects a real existing permission check', () => {
    expect(alreadyHasPermissionCheck(HAS_CHECK_SOURCE)).toBe(true);
  });

  it('produces a real, correctly-inserted patch for a missing check', () => {
    const result = insertPermissionCheck(MISSING_CHECK_SOURCE, 'read:x');
    expect(result.patched).not.toBeNull();
    expect(result.patched).toContain("await this.enforcePermission('read:x');");
    expect(result.patched).toContain('return x * 2;');
  });

  it('correctly skips a method that already has a real check, no double-patch', () => {
    const result = insertPermissionCheck(HAS_CHECK_SOURCE, 'x');
    expect(result.patched).toBeNull();
    expect(result.reason).toContain('already has');
  });
});

describe('AgentSpecRepairBot', () => {
  describe('proposePatches', () => {
    const findings: SpecRepairFinding[] = [
      { methodName: 'doThing', methodSource: MISSING_CHECK_SOURCE, requiredScope: 'read:x' },
      { methodName: 'alreadyGood', methodSource: HAS_CHECK_SOURCE, requiredScope: 'x' },
    ];

    it('produces real patches only for methods that genuinely need one', async () => {
      const bot = new AgentSpecRepairBot(makeSpec());
      const results = await bot.proposePatches(findings);

      const doThing = results.find((r) => r.methodName === 'doThing');
      const alreadyGood = results.find((r) => r.methodName === 'alreadyGood');

      expect(doThing?.patchResult.patched).not.toBeNull();
      expect(alreadyGood?.patchResult.patched).toBeNull();
    });

    it('signals the swarm when real patches are proposed', async () => {
      const bot = new AgentSpecRepairBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.proposePatches(findings);

      expect(received).toHaveLength(1);
      unsubscribe();
    });

    it('does not signal when nothing genuinely needs a patch', async () => {
      const bot = new AgentSpecRepairBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.proposePatches([{ methodName: 'alreadyGood', methodSource: HAS_CHECK_SOURCE, requiredScope: 'x' }]);

      expect(received).toHaveLength(0);
      unsubscribe();
    });

    it('blocks proposing patches without read:agent-spec-findings permission', async () => {
      const bot = new AgentSpecRepairBot(makeSpec({ permissionScope: [] }));
      await expect(bot.proposePatches(findings)).rejects.toThrow('outside its declared permissionScope');
    });
  });
});
