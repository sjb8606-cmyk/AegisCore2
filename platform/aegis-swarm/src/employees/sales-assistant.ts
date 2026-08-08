/**
 * platform/aegis-swarm/src/employees/sales-assistant.ts
 *
 * E-24 — Sales Assistant.
 *
 * Real lead scoring against real, objective completeness signals
 * pulled from the actual CRM record — same multi-criteria discipline
 * as E-06's grant matching. Deliberately does NOT score based on
 * fabricated assumptions like "which source converts better" — that
 * would need real historical conversion data this system doesn't
 * have yet. Every point scored maps to a real, verifiable field on
 * the actual lead record. Verified against a complete lead and a
 * bare-minimum lead before implementation.
 */

import { CrystalBot } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { CrmLead } from '../lib/crm-store';

export interface LeadScoreResult {
  leadId: string;
  score: number;
  reasons: string[];
}

export function scoreLead(lead: CrmLead): LeadScoreResult {
  let score = 0;
  const reasons: string[] = [];

  if (lead.contactEmail) {
    score += 30;
    reasons.push('Has a real contact email');
  } else {
    reasons.push('Missing contact email — real gap in reachability');
  }

  if (lead.estimatedValue !== null && lead.estimatedValue > 0) {
    score += 30;
    reasons.push(`Estimated value of $${lead.estimatedValue} provided`);
  } else {
    reasons.push('No estimated value provided yet');
  }

  if (lead.notes && lead.notes.trim().length > 0) {
    score += 20;
    reasons.push('Has real notes/context recorded');
  } else {
    reasons.push('No notes/context recorded yet');
  }

  if (lead.source) {
    score += 20;
    reasons.push(`Source tracked: ${lead.source}`);
  } else {
    reasons.push('Source not tracked');
  }

  return { leadId: lead.id, score, reasons };
}

export class SalesAssistantBot extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async scoreLeads(leads: CrmLead[]): Promise<LeadScoreResult[]> {
    await this.enforcePermission('read:crm-leads');

    const results = leads.map(scoreLead);

    await this.createDecision(
      { leadCount: leads.length },
      { averageScore: results.length ? results.reduce((s, r) => s + r.score, 0) / results.length : 0 },
      'sales-assistant-v1',
    );

    return results;
  }
}
