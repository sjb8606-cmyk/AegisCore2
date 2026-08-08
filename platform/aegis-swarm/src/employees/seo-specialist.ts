/**
 * platform/aegis-swarm/src/employees/seo-specialist.ts
 *
 * E-22 — SEO Specialist.
 *
 * Real on-page SEO scan against real HTML: title tag presence and
 * length range, meta description presence, H1 presence (exactly
 * one). Genuinely checkable regex-based signals, same discipline as
 * E-07/E-21. Verified against a good-SEO case (zero findings) and a
 * real bad-SEO case before implementation.
 */

import { CrystalBot } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';

export type SeoFindingType =
  | 'missing_title'
  | 'title_length_out_of_range'
  | 'missing_meta_description'
  | 'missing_h1'
  | 'multiple_h1';

const MIN_TITLE_LENGTH = 10;
const MAX_TITLE_LENGTH = 60;

export function scanSeo(html: string): SeoFindingType[] {
  const findings: SeoFindingType[] = [];

  const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
  if (!titleMatch) {
    findings.push('missing_title');
  } else if (titleMatch[1].length < MIN_TITLE_LENGTH || titleMatch[1].length > MAX_TITLE_LENGTH) {
    findings.push('title_length_out_of_range');
  }

  const metaDescMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i);
  if (!metaDescMatch) findings.push('missing_meta_description');

  const h1Matches = html.match(/<h1[^>]*>/gi) || [];
  if (h1Matches.length === 0) findings.push('missing_h1');
  else if (h1Matches.length > 1) findings.push('multiple_h1');

  return findings;
}

export interface SeoReport {
  findings: SeoFindingType[];
  clean: boolean;
}

export class SeoSpecialistBot extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async scanPage(html: string): Promise<SeoReport> {
    await this.enforcePermission('read:page-html');

    const findings = scanSeo(html);
    const report: SeoReport = { findings, clean: findings.length === 0 };

    await this.createDecision({ htmlLength: html.length }, { findingCount: findings.length }, 'seo-specialist-v1');

    if (findings.length > 0) {
      await this.signalSwarm('employee.seo_findings', { botId: this.botId, findingCount: findings.length });
    }

    return report;
  }
}
