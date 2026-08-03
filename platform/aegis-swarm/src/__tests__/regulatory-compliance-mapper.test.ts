import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { RegulatoryComplianceMapperBot, SystemFacts } from '../bots/regulatory-compliance-mapper';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'D-13',
    role: 'Test Regulatory Compliance Mapper used to verify control-to-evidence mapping.',
    triggerConditions: ['manual'],
    behaviorDescription:
      'Test-only Regulatory Compliance Mapper used to verify gap detection across the illustrative control set.',
    permissionScope: ['read:compliance-facts'],
    hitlClassification: 'Logging',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

const ALL_SATISFIED: SystemFacts = {
  rlsEnabled: true,
  permissionBoundaryEnforced: true,
  auditTrailExists: true,
  encryptionAtRest: true,
  gdprDeletionWorkflowExists: true,
};

const ALL_MISSING: SystemFacts = {
  rlsEnabled: false,
  permissionBoundaryEnforced: false,
  auditTrailExists: false,
  encryptionAtRest: false,
  gdprDeletionWorkflowExists: false,
};

const THIS_REPO_TONIGHT: SystemFacts = {
  rlsEnabled: true,
  permissionBoundaryEnforced: true,
  auditTrailExists: true,
  encryptionAtRest: false,
  gdprDeletionWorkflowExists: true,
};

describe('RegulatoryComplianceMapperBot', () => {
  describe('mapPosture', () => {
    it('reports all controls satisfied when every fact is true', async () => {
      const bot = new RegulatoryComplianceMapperBot(makeSpec());
      const report = await bot.mapPosture(ALL_SATISFIED);

      expect(report.gapCount).toBe(0);
      expect(report.satisfiedCount).toBe(report.results.length);
    });

    it('reports every control as a gap when every fact is false', async () => {
      const bot = new RegulatoryComplianceMapperBot(makeSpec());
      const report = await bot.mapPosture(ALL_MISSING);

      expect(report.gapCount).toBe(report.results.length);
      expect(report.satisfiedCount).toBe(0);
    });

    it('correctly identifies the encryption-at-rest gap for this repo\'s real, honest current state', async () => {
      const bot = new RegulatoryComplianceMapperBot(makeSpec());
      const report = await bot.mapPosture(THIS_REPO_TONIGHT);

      const gapIds = report.gaps.map((g) => g.controlId);
      expect(gapIds).toContain('ISO27001-A.8.24');
      expect(gapIds).toContain('HIPAA-164.312(a)(2)(iv)');
      expect(report.gapCount).toBe(2);
    });

    it('never treats a missing/false fact as satisfied', async () => {
      const bot = new RegulatoryComplianceMapperBot(makeSpec());
      const report = await bot.mapPosture({ ...ALL_SATISFIED, auditTrailExists: false });

      const auditControls = report.results.filter((r) => r.description.toLowerCase().includes('audit') || r.description.toLowerCase().includes('processing') || r.description.toLowerCase().includes('logged'));
      expect(auditControls.some((c) => c.satisfied)).toBe(false);
    });

    it('signals the swarm when at least one gap is found', async () => {
      const bot = new RegulatoryComplianceMapperBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.mapPosture(THIS_REPO_TONIGHT);

      expect(received).toHaveLength(1);
      unsubscribe();
    });

    it('does not signal the swarm when there are no gaps', async () => {
      const bot = new RegulatoryComplianceMapperBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.mapPosture(ALL_SATISFIED);

      expect(received).toHaveLength(0);
      unsubscribe();
    });

    it('blocks mapping without read:compliance-facts permission', async () => {
      const bot = new RegulatoryComplianceMapperBot(makeSpec({ permissionScope: [] }));
      await expect(bot.mapPosture(ALL_SATISFIED)).rejects.toThrow('outside its declared permissionScope');
    });
  });
});
