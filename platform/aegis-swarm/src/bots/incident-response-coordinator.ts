/**
 * platform/aegis-swarm/src/bots/incident-response-coordinator.ts
 *
 * D-14 — Incident Response Coordinator.
 *
 * "Manages playbooks, timelines, communications" splits three ways:
 *
 * - Timelines: real. Every incident has an append-only, atomically
 *   updated timeline (see incident-store.ts) and a guarded 3-state
 *   lifecycle (open -> investigating -> resolved, never backwards).
 * - Playbooks: real, but deliberately small and illustrative — a
 *   static lookup table mapping a handful of incident categories
 *   (matching what this swarm's own bots actually detect: secrets
 *   exposure, tenant scoping bypass, privilege override, dependency
 *   vulnerabilities) to a short list of response steps. Not a claim
 *   to cover every possible incident type.
 * - Communications: NOT available. Actually notifying responders
 *   (Slack, PagerDuty, email, etc.) needs a real integration and
 *   network access this sandbox doesn't have. notifyResponders()
 *   throws a clear, honest error rather than faking delivery.
 *
 * A natural real integration: Sentinel Prime's (D-01) correlated
 * incident signal is exactly the kind of trigger that should open a
 * formal incident here — that wiring is for whoever calls both bots,
 * not hardcoded inside either one.
 */

import { CrystalBot } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import {
  openIncident,
  appendTimelineEvent,
  updateIncidentStatus,
  getIncident,
  SecurityIncident,
  IncidentStatus,
} from '../lib/incident-store';

export interface IncidentOpenResult extends SecurityIncident {
  decisionId: string;
}

const PLAYBOOKS: Record<string, string[]> = {
  secrets_exposure: [
    'Rotate the exposed credential immediately',
    'Audit access logs for the affected credential over its exposure window',
    'Confirm the credential is removed from git history, not just the working tree',
  ],
  tenant_scoping_bypass: [
    'Identify every request that hit the vulnerable code path',
    'Determine whether any cross-tenant data was actually read or written',
    'Notify affected tenant(s) if their data was exposed',
    'Patch the raw-header-based identity resolution and redeploy',
  ],
  privilege_override: [
    'Confirm whether the hardcoded identity match was ever actually exercised in production',
    'Revoke the special-cased access immediately',
    'Review git blame/history to establish intent and timeline',
  ],
  dependency_vulnerability: [
    'Confirm exploitability in this specific usage context, not just CVE presence',
    'Patch or pin to a fixed version',
    'Re-run the dependency scan to confirm resolution',
  ],
};

export class IncidentResponseCoordinatorBot extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async openIncident(tenantId: string, category: string, description: string): Promise<IncidentOpenResult> {
    await this.enforcePermission('write:incidents');

    const incident = await openIncident(tenantId, category, description);

    const decision = await this.createDecision(
      { tenantId, category, description },
      { incidentId: incident.id },
      'incident-response-open-v1',
    );

    await this.signalSwarm('incident_response.incident_opened', {
      botId: this.botId,
      incidentId: incident.id,
      tenantId,
      category,
    });

    return { ...incident, decisionId: decision.id };
  }

  async appendTimelineEvent(
    tenantId: string,
    incidentId: string,
    eventType: string,
    detail: string,
  ): Promise<{ appended: boolean }> {
    await this.enforcePermission('write:incidents');
    const appended = await appendTimelineEvent(tenantId, incidentId, eventType, detail);
    return { appended };
  }

  async updateIncidentStatus(
    tenantId: string,
    incidentId: string,
    newStatus: IncidentStatus,
  ): Promise<{ updated: boolean }> {
    await this.enforcePermission('write:incidents');

    const updated = await updateIncidentStatus(tenantId, incidentId, newStatus);

    await this.createDecision({ tenantId, incidentId, newStatus }, { updated }, 'incident-response-status-v1');

    if (updated && newStatus === 'resolved') {
      await this.signalSwarm('incident_response.incident_resolved', {
        botId: this.botId,
        incidentId,
        tenantId,
      });
    }

    return { updated };
  }

  async getIncidentStatus(tenantId: string, incidentId: string): Promise<SecurityIncident | null> {
    await this.enforcePermission('read:incidents');
    return getIncident(tenantId, incidentId);
  }

  async matchPlaybook(category: string): Promise<string[] | null> {
    await this.enforcePermission('read:playbooks');
    return PLAYBOOKS[category] ?? null;
  }

  async notifyResponders(_incidentId: string, _channel: string): Promise<never> {
    throw new Error(
      'Live responder notification is not available yet: this environment has no configured ' +
        'notification channel (Slack/PagerDuty/email) and no network access to verify a real ' +
        'delivery against. openIncident()/appendTimelineEvent()/updateIncidentStatus() work today ' +
        'for tracking the incident itself — wiring in real notifications is separate integration work.',
    );
  }
}
