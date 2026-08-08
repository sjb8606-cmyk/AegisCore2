import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { DependencyRepairBot, planRepairs, NpmAuditVulnerabilities } from '../repair/dependency-repair';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'RS-03',
    role: 'Test Dependency Repair used to verify real npm audit classification.',
    triggerConditions: ['manual'],
    behaviorDescription: 'Test-only Dependency Repair used to verify real repair planning.',
    permissionScope: ['read:dependency-audit'],
    hitlClassification: 'Alert',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

const SAMPLE: NpmAuditVulnerabilities = {
  lodash: { severity: 'high', fixAvailable: { name: 'lodash', version: '4.17.21', isSemVerMajor: false } },
  express: { severity: 'critical', fixAvailable: { name: 'express', version: '5.0.0', isSemVerMajor: true } },
  'old-pkg': { severity: 'moderate', fixAvailable: false },
};

describe('planRepairs (pure real npm audit classification)', () => {
  it('classifies a real non-breaking fix as auto-fixable', () => {
    const plan = planRepairs(SAMPLE);
    expect(plan.autoFixable).toContain('lodash');
  });

  it('routes a real breaking-change fix to manual review, never auto-fixable', () => {
    const plan = planRepairs(SAMPLE);
    expect(plan.needsManualReview.map((i) => i.name)).toContain('express');
    expect(plan.autoFixable).not.toContain('express');
  });

  it('reports a real no-fix-available package correctly', () => {
    const plan = planRepairs(SAMPLE);
    expect(plan.noFixAvailable).toContain('old-pkg');
  });
});

describe('DependencyRepairBot', () => {
  describe('proposeRepairPlan', () => {
    it('produces a real, complete repair plan', async () => {
      const bot = new DependencyRepairBot(makeSpec());
      const plan = await bot.proposeRepairPlan(SAMPLE);

      expect(plan.autoFixable).toHaveLength(1);
      expect(plan.needsManualReview).toHaveLength(1);
      expect(plan.noFixAvailable).toHaveLength(1);
    });

    it('signals the swarm when a real breaking-change review is needed', async () => {
      const bot = new DependencyRepairBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.proposeRepairPlan(SAMPLE);

      expect(received).toHaveLength(1);
      unsubscribe();
    });

    it('blocks planning without read:dependency-audit permission', async () => {
      const bot = new DependencyRepairBot(makeSpec({ permissionScope: [] }));
      await expect(bot.proposeRepairPlan(SAMPLE)).rejects.toThrow('outside its declared permissionScope');
    });
  });
});
