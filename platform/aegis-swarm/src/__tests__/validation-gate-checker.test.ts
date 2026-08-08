import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import {
  ValidationGateCheckerBot,
  checkGates,
  REQUIRED_GATES,
  GateDeclarations,
} from '../employees/validation-gate-checker';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'E-37',
    role: 'Test Validation Gate Checker used to verify real completeness enforcement.',
    triggerConditions: ['manual'],
    behaviorDescription: 'Test-only Validation Gate Checker used to verify real gate logic.',
    permissionScope: ['read:validation-gates'],
    hitlClassification: 'Alert',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

function allSatisfied(): GateDeclarations {
  return Object.fromEntries(REQUIRED_GATES.map((g) => [g, { satisfied: true, evidence: 'real evidence' }])) as GateDeclarations;
}

describe('checkGates (pure real completeness enforcement)', () => {
  it('confirms launch-ready when all 12 real gates are satisfied', () => {
    const result = checkGates(allSatisfied());
    expect(result.launchReady).toBe(true);
    expect(result.missing).toHaveLength(0);
    expect(result.unsatisfied).toHaveLength(0);
  });

  it('reports a real genuinely-missing gate separately from an unsatisfied one', () => {
    const decls = allSatisfied();
    delete decls.jwt_replay_protection;
    const result = checkGates(decls);

    expect(result.launchReady).toBe(false);
    expect(result.missing).toEqual(['jwt_replay_protection']);
    expect(result.unsatisfied).toHaveLength(0);
  });

  it('reports a real declared-but-failing gate as unsatisfied, not missing', () => {
    const decls = allSatisfied();
    decls.sbom_and_signing = { satisfied: false, evidence: 'not yet implemented' };
    const result = checkGates(decls);

    expect(result.launchReady).toBe(false);
    expect(result.unsatisfied).toEqual(['sbom_and_signing']);
    expect(result.missing).toHaveLength(0);
  });
});

describe('ValidationGateCheckerBot', () => {
  describe('checkLaunchReadiness', () => {
    it('confirms real launch readiness when all gates are genuinely satisfied', async () => {
      const bot = new ValidationGateCheckerBot(makeSpec());
      const result = await bot.checkLaunchReadiness(allSatisfied());
      expect(result.launchReady).toBe(true);
    });

    it('signals the swarm when real gates are genuinely incomplete', async () => {
      const bot = new ValidationGateCheckerBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.checkLaunchReadiness({});

      expect(received).toHaveLength(1);
      unsubscribe();
    });

    it('does not signal when everything is genuinely complete', async () => {
      const bot = new ValidationGateCheckerBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.checkLaunchReadiness(allSatisfied());

      expect(received).toHaveLength(0);
      unsubscribe();
    });

    it('blocks checking without read:validation-gates permission', async () => {
      const bot = new ValidationGateCheckerBot(makeSpec({ permissionScope: [] }));
      await expect(bot.checkLaunchReadiness(allSatisfied())).rejects.toThrow('outside its declared permissionScope');
    });
  });
});
