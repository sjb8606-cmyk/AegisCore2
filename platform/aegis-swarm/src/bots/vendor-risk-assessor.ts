/**
 * platform/aegis-swarm/src/bots/vendor-risk-assessor.ts
 *
 * D-19 — Vendor Risk Assessor.
 *
 * "Scores third-party vendors against threat intel" composes directly
 * with D-05's real, normalized ThreatIndicator[] output — this bot
 * does not parse STIX/MISP itself or reinvent threat matching. Given
 * a vendor's known infrastructure (domains/IPs) and a set of already-
 * normalized indicators (from D-05), it checks for direct overlap.
 *
 * Scoring is deliberately simple and transparent: each matched
 * indicator adds a fixed weight, capped at 100. This is not a claim
 * to sophisticated risk modeling — it's an honest, explainable
 * "how many known-bad indicators point at this vendor's own
 * infrastructure" count, not a black-box score.
 */

import { CrystalBot, Finding } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { ThreatIndicator } from './threat-intel-aggregator';

const RISK_WEIGHT_PER_MATCH = 25;
const MAX_RISK_SCORE = 100;

export interface VendorRiskReport {
  vendorName: string;
  matchedIndicators: ThreatIndicator[];
  riskScore: number;
  findings: Finding[];
}

export class VendorRiskAssessorBot extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async assessVendor(
    vendorName: string,
    vendorInfrastructure: string[],
    threatIndicators: ThreatIndicator[],
  ): Promise<VendorRiskReport> {
    await this.enforcePermission('read:vendor-risk-data');

    const infraSet = new Set(vendorInfrastructure.map((s) => s.toLowerCase()));
    const matchedIndicators = threatIndicators.filter((indicator) =>
      infraSet.has(indicator.value.toLowerCase()),
    );

    const riskScore = Math.min(matchedIndicators.length * RISK_WEIGHT_PER_MATCH, MAX_RISK_SCORE);

    const findings: Finding[] = matchedIndicators.map((indicator) => ({
      cat: 'sec',
      sev: 'crit',
      loc: `vendor:${vendorName}`,
      desc: `Vendor "${vendorName}"'s infrastructure (${indicator.value}) matches a known threat indicator (${indicator.source}, ${indicator.indicatorType})`,
      rec: 'Confirm whether this vendor infrastructure is genuinely compromised or if this is a stale/reused indicator. A vendor with matched threat indicators is a real supply-chain risk worth reviewing before continued reliance.',
    }));

    const pi = this.computePI(findings);

    await this.createDecision(
      { vendorName, infrastructureCount: vendorInfrastructure.length, indicatorCount: threatIndicators.length },
      { riskScore, matchCount: matchedIndicators.length, pi },
      'vendor-risk-assessor-v1',
    );

    if (matchedIndicators.length > 0) {
      await this.signalSwarm('vendor_risk.threat_match_found', {
        botId: this.botId,
        vendorName,
        riskScore,
        matchCount: matchedIndicators.length,
      });
    }

    return { vendorName, matchedIndicators, riskScore, findings };
  }
}
