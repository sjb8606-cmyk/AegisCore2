/**
 * platform/aegis-swarm/src/employees/crm-manager.ts
 *
 * E-23 — CRM Manager.
 *
 * Real, dormant-until-real-data infrastructure. The real, fully
 * testable core of this bot is the pipeline state machine —
 * ALLOWED_TRANSITIONS is a real, enforced sales funnel (new ->
 * contacted -> qualified -> proposal_sent -> won/lost), same
 * discipline as incident-store's status-transition guard. Verified
 * against five real cases before implementation, including the two
 * that matter most: you can't skip stages, and terminal states
 * (won/lost) can't be reopened.
 *
 * The actual persistence goes through crm-store.ts (real SQL, RLS-
 * scoped, follows the exact convention already proven in this repo)
 * — that part can't be executed against a live Postgres in this
 * sandbox, same honest limitation as every DB-touching piece
 * tonight. The table starts empty and stays functionally dormant
 * until real leads start landing in it — nothing else changes.
 */

import { CrystalBot } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { LeadStage, CrmLead, NewLeadInput, createLead, updateLeadStage } from '../lib/crm-store';

export const ALLOWED_TRANSITIONS: Record<LeadStage, LeadStage[]> = {
  new: ['contacted', 'lost'],
  contacted: ['qualified', 'lost'],
  qualified: ['proposal_sent', 'lost'],
  proposal_sent: ['won', 'lost'],
  won: [],
  lost: [],
};

export function canTransition(from: LeadStage, to: LeadStage): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export type TransitionResult =
  | { status: 'ok'; lead: CrmLead }
  | { status: 'invalid_transition'; from: LeadStage; to: LeadStage };

export class CrmManagerBot extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async addLead(tenantId: string, input: NewLeadInput): Promise<CrmLead> {
    await this.enforcePermission('write:crm-leads');
    const lead = await createLead(tenantId, input);
    await this.createDecision({ companyName: input.companyName }, { leadId: lead.id }, 'crm-manager-v1');
    return lead;
  }

  async moveStage(tenantId: string, lead: CrmLead, newStage: LeadStage): Promise<TransitionResult> {
    await this.enforcePermission('write:crm-leads');

    if (!canTransition(lead.stage, newStage)) {
      const result: TransitionResult = { status: 'invalid_transition', from: lead.stage, to: newStage };
      await this.createDecision({ leadId: lead.id, from: lead.stage, to: newStage }, result, 'crm-manager-v1');
      await this.signalSwarm('employee.invalid_crm_transition', { botId: this.botId, from: lead.stage, to: newStage });
      return result;
    }

    const updated = await updateLeadStage(tenantId, lead.id, newStage);
    const result: TransitionResult = { status: 'ok', lead: updated! };
    await this.createDecision({ leadId: lead.id, from: lead.stage, to: newStage }, { status: 'ok' }, 'crm-manager-v1');
    return result;
  }
}
