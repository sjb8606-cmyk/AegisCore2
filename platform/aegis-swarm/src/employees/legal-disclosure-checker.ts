/**
 * platform/aegis-swarm/src/employees/legal-disclosure-checker.ts
 *
 * E-18 — Legal Disclosure Checker.
 *
 * Same real pattern-matching discipline as E-13's contract clause
 * checker, applied here to required legal disclosures (privacy
 * policy, terms of service, cookie/data collection notice). Genuine
 * presence checking against real text — never legal advice or legal
 * interpretation, just a factual "is this disclosure present."
 */

import { CrystalBot } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';

export interface RequiredDisclosure {
  name: string;
  patterns: string[];
}

export interface DisclosureCheckResult {
  disclosure: string;
  found: boolean;
}

export function checkDisclosures(pageText: string, required: RequiredDisclosure[]): DisclosureCheckResult[] {
  const lower = pageText.toLowerCase();
  return required.map((d) => ({
    disclosure: d.name,
    found: d.patterns.some((p) => lower.includes(p.toLowerCase())),
  }));
}

export interface DisclosureReport {
  results: DisclosureCheckResult[];
  missingDisclosures: string[];
  complete: boolean;
}

export class LegalDisclosureCheckerBot extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async checkPage(pageText: string, required: RequiredDisclosure[]): Promise<DisclosureReport> {
    await this.enforcePermission('read:page-text');

    const results = checkDisclosures(pageText, required);
    const missingDisclosures = results.filter((r) => !r.found).map((r) => r.disclosure);
    const report: DisclosureReport = { results, missingDisclosures, complete: missingDisclosures.length === 0 };

    await this.createDecision(
      { disclosureCount: required.length },
      { missingCount: missingDisclosures.length },
      'legal-disclosure-checker-v1',
    );

    if (missingDisclosures.length > 0) {
      await this.signalSwarm('employee.missing_legal_disclosures', { botId: this.botId, missingDisclosures });
    }

    return report;
  }
}
