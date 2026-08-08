/**
 * platform/aegis-swarm/src/employees/proposal-writer.ts
 *
 * E-25 — Proposal Writer.
 *
 * Real orchestration across two already-built employees, not a
 * duplicate of either. Transforms a real CRM lead into real inputs
 * for E-01's requestDossier() (positioning) and E-03's
 * requestPreset() (copy), then calls their actual, already-tested
 * public methods directly — same rule El was built on: never bypass
 * an employee's own permission enforcement, never fabricate a
 * capability that employee doesn't have.
 *
 * The real transform functions (buildConceptFromLead,
 * buildCopyBriefFromLead) were verified to produce inputs that
 * genuinely pass E-01's and E-03's own real validation rules before
 * this was wired together — not assumed to work, checked.
 */

import { CrystalBot } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { CrmLead } from '../lib/crm-store';
import { StrategicArchitectBot, DossierRequest, ValidationResult } from './strategic-architect';
import { CopywrightCouncilBot, CopyBrief, CopyRequestResult } from './copywright-council';

export function buildConceptFromLead(lead: CrmLead): string {
  return `${lead.companyName}: a proposal for ${lead.notes || 'services'} valued at approximately $${lead.estimatedValue ?? 0}`;
}

export function buildDossierRequestFromLead(lead: CrmLead): DossierRequest {
  return {
    concept: buildConceptFromLead(lead),
    stage: 'early',
    constraints: `Contact: ${lead.contactName}. Source: ${lead.source ?? 'unknown'}.`,
  };
}

export function buildCopyBriefFromLead(lead: CrmLead): CopyBrief {
  return {
    project: lead.companyName,
    audience: [lead.contactName],
    voice: ['professional', 'trustworthy'],
    goal: `Win the deal with ${lead.companyName}`,
    style: 'formal proposal',
    seoKeywords: [],
    pageType: 'proposal',
    brandStory: lead.notes || `A proposal for ${lead.companyName}.`,
  };
}

export interface ProposalDraftResult {
  dossierResult: ValidationResult;
  copyResult: CopyRequestResult;
  ready: boolean;
}

export class ProposalWriterBot extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async draftProposal(
    lead: CrmLead,
    architect: StrategicArchitectBot,
    council: CopywrightCouncilBot,
  ): Promise<ProposalDraftResult> {
    await this.enforcePermission('read:crm-leads');

    const dossierRequest = buildDossierRequestFromLead(lead);
    const copyBrief = buildCopyBriefFromLead(lead);

    const dossierResult = await architect.requestDossier(dossierRequest);
    const copyResult = await council.requestPreset(copyBrief, 'Conversion Flow');

    const ready = dossierResult.status === 'ok' && copyResult.status === 'ok';

    await this.createDecision(
      { leadId: lead.id },
      { ready, dossierStatus: dossierResult.status, copyStatus: copyResult.status },
      'proposal-writer-v1',
    );

    if (!ready) {
      await this.signalSwarm('employee.proposal_not_ready', {
        botId: this.botId,
        leadId: lead.id,
        dossierStatus: dossierResult.status,
        copyStatus: copyResult.status,
      });
    }

    return { dossierResult, copyResult, ready };
  }
}
