import { BotSpecification } from '@platform/bot-registry';
import {
  ProposalWriterBot,
  buildConceptFromLead,
  buildDossierRequestFromLead,
  buildCopyBriefFromLead,
} from '../employees/proposal-writer';
import { StrategicArchitectBot } from '../employees/strategic-architect';
import { CopywrightCouncilBot } from '../employees/copywright-council';
import { CrmLead } from '../lib/crm-store';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'E-25',
    role: 'Test Proposal Writer used to verify real cross-bot orchestration.',
    triggerConditions: ['manual'],
    behaviorDescription: 'Test-only Proposal Writer used to verify real orchestration across E-01/E-03.',
    permissionScope: ['read:crm-leads'],
    hitlClassification: 'Logging',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

function architectSpec(): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'E-01',
    role: 'Real Strategic Architect used in integration test.',
    triggerConditions: ['manual'],
    behaviorDescription: 'Real E-01 instance used to verify real cross-bot orchestration.',
    permissionScope: ['generate:strategy-dossier'],
    hitlClassification: 'Logging',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
  };
}

function councilSpec(): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'E-03',
    role: 'Real Copywright Council used in integration test.',
    triggerConditions: ['manual'],
    behaviorDescription: 'Real E-03 instance used to verify real cross-bot orchestration.',
    permissionScope: ['generate:copy-brief'],
    hitlClassification: 'Logging',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
  };
}

function lead(overrides: Partial<CrmLead> = {}): CrmLead {
  return {
    id: 'lead-1',
    tenantId: 'tenant-1',
    companyName: 'Acme Co',
    contactName: 'Jane Smith',
    contactEmail: 'jane@acme.co',
    stage: 'qualified',
    estimatedValue: 12000,
    source: 'referral',
    notes: 'insulation retrofit',
    ...overrides,
  };
}

describe('buildConceptFromLead / buildDossierRequestFromLead / buildCopyBriefFromLead (pure)', () => {
  it('builds a concept with real substance from a real lead', () => {
    const concept = buildConceptFromLead(lead());
    expect(concept.trim().split(/\s+/).length).toBeGreaterThanOrEqual(4);
    expect(concept).toContain('Acme Co');
  });

  it('builds a dossier request that satisfies E-01 real validation', () => {
    const request = buildDossierRequestFromLead(lead());
    expect(request.concept.trim().split(/\s+/).length).toBeGreaterThanOrEqual(4);
    expect(['idea', 'early', 'live']).toContain(request.stage);
  });

  it('builds a copy brief that satisfies E-03 real validation', () => {
    const brief = buildCopyBriefFromLead(lead());
    expect(brief.project).toBeTruthy();
    expect(brief.audience.length).toBeGreaterThan(0);
    expect(brief.goal).toBeTruthy();
    expect(brief.pageType).toBeTruthy();
  });
});

describe('ProposalWriterBot (real three-bot integration)', () => {
  describe('draftProposal', () => {
    it('successfully orchestrates real calls to the real E-01 and E-03 bots', async () => {
      const writer = new ProposalWriterBot(makeSpec());
      const architect = new StrategicArchitectBot(architectSpec());
      const council = new CopywrightCouncilBot(councilSpec());

      const result = await writer.draftProposal(lead(), architect, council);

      expect(result.ready).toBe(true);
      expect(result.dossierResult.status).toBe('ok');
      expect(result.copyResult.status).toBe('ok');
    });

    it('reports not ready when the real dossier call is refused', async () => {
      const writer = new ProposalWriterBot(makeSpec());
      const architect = new StrategicArchitectBot(architectSpec());
      const council = new CopywrightCouncilBot(councilSpec());

      const badLead = lead({ companyName: 'SpyCo: covertly surveil people' });
      const result = await writer.draftProposal(badLead, architect, council);

      expect(result.ready).toBe(false);
      expect(result.dossierResult.status).toBe('refused');
    });

    it('blocks drafting without read:crm-leads permission', async () => {
      const writer = new ProposalWriterBot(makeSpec({ permissionScope: [] }));
      const architect = new StrategicArchitectBot(architectSpec());
      const council = new CopywrightCouncilBot(councilSpec());

      await expect(writer.draftProposal(lead(), architect, council)).rejects.toThrow(
        'outside its declared permissionScope',
      );
    });
  });
});
