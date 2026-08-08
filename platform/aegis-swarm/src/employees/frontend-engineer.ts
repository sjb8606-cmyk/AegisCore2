/**
 * platform/aegis-swarm/src/employees/frontend-engineer.ts
 *
 * E-21 — Frontend Engineer.
 *
 * Real accessibility scanner, same regex-scanning discipline as E-07
 * — genuine checkable signals against real HTML: missing alt
 * attributes on img tags, form inputs with no real label association
 * (no id and no aria-label). Verified against a clean-HTML case
 * (zero findings) and a real broken case before implementation.
 */

import { CrystalBot } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';

export interface A11yFinding {
  type: 'missing_alt' | 'missing_label_association';
  tag: string;
}

export function scanAccessibility(html: string): A11yFinding[] {
  const findings: A11yFinding[] = [];

  const imgTags = html.match(/<img[^>]*>/gi) || [];
  for (const tag of imgTags) {
    if (!/alt\s*=/i.test(tag)) findings.push({ type: 'missing_alt', tag });
  }

  const inputTags = html.match(/<input[^>]*>/gi) || [];
  for (const tag of inputTags) {
    if (!/aria-label|id\s*=/i.test(tag)) findings.push({ type: 'missing_label_association', tag });
  }

  return findings;
}

export interface A11yReport {
  findings: A11yFinding[];
  clean: boolean;
}

export class FrontendEngineerBot extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async scanPage(html: string): Promise<A11yReport> {
    await this.enforcePermission('read:page-html');

    const findings = scanAccessibility(html);
    const report: A11yReport = { findings, clean: findings.length === 0 };

    await this.createDecision({ htmlLength: html.length }, { findingCount: findings.length }, 'frontend-engineer-v1');

    if (findings.length > 0) {
      await this.signalSwarm('employee.accessibility_findings', { botId: this.botId, findingCount: findings.length });
    }

    return report;
  }
}
