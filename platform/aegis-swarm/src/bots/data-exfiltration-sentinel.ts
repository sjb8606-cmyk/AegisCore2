/**
 * platform/aegis-swarm/src/bots/data-exfiltration-sentinel.ts
 *
 * D-15 — Data Exfiltration Sentinel.
 *
 * "Monitors outbound flows for anomalies" overlaps conceptually with
 * D-07 (Behavioral Anomaly Detector) — both do statistical baseline
 * deviation. Rather than duplicate that math (the D-11 trap: building
 * a redundant bot that just relabels something that already exists),
 * this bot genuinely REUSES D-07's exact, verified z-score functions
 * (computeBaseline/scoreAgainstBaseline, refactored to be exported
 * standalone functions specifically so this composition is possible).
 *
 * What's actually NEW and distinct here — the real reason this is its
 * own bot, not just D-07 with different labels: destination-allowlist
 * checking. A flow to an unrecognized destination is suspicious
 * regardless of volume — pure statistical anomaly detection wouldn't
 * catch a small, quiet exfiltration to a new destination, since a
 * small transfer never looks anomalous by volume alone.
 *
 * A flow to a non-allowlisted destination is flagged on that basis
 * alone and not also volume-checked — it's already the more serious
 * finding (block, vs crit for a volume anomaly to a KNOWN
 * destination), and double-flagging the same flow would be noise.
 */

import { CrystalBot, Finding } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { computeBaseline, scoreAgainstBaseline } from './behavioral-anomaly-detector';

export interface OutboundFlow {
  destination: string;
  bytesTransferred: number;
}

export interface ExfiltrationScanReport {
  findings: Finding[];
  flowsChecked: number;
}

export class DataExfiltrationSentinelBot extends CrystalBot {
  private allowlist: Set<string>;

  constructor(spec: BotSpecification, allowlist: string[] = []) {
    super(spec);
    this.allowlist = new Set(allowlist);
  }

  async monitorOutboundFlows(
    flows: OutboundFlow[],
    volumeBaseline?: number[],
    thresholdSigma?: number,
  ): Promise<ExfiltrationScanReport> {
    await this.enforcePermission('read:outbound-flows');

    const findings: Finding[] = [];

    for (const flow of flows) {
      if (!this.allowlist.has(flow.destination)) {
        findings.push({
          cat: 'sec',
          sev: 'block',
          loc: flow.destination,
          desc: `Outbound flow to non-allowlisted destination "${flow.destination}" (${flow.bytesTransferred} bytes)`,
          rec: 'Confirm this destination is legitimate. If not, treat as a possible exfiltration attempt and investigate immediately.',
        });
        continue;
      }

      if (volumeBaseline && volumeBaseline.length >= 2) {
        const baseline = computeBaseline(volumeBaseline);
        const result = scoreAgainstBaseline(baseline, flow.bytesTransferred, thresholdSigma);
        if (result.isAnomaly) {
          findings.push({
            cat: 'sec',
            sev: 'crit',
            loc: flow.destination,
            desc: `Unusually large outbound transfer to known destination "${flow.destination}": ${flow.bytesTransferred} bytes (z-score ${result.zScore.toFixed(2)})`,
            rec: 'Confirm this transfer was legitimate and expected. An allowlisted destination receiving an abnormal volume can still indicate a compromised or misused legitimate channel.',
          });
        }
      }
    }

    const pi = this.computePI(findings);

    await this.createDecision(
      { flowsChecked: flows.length, allowlistSize: this.allowlist.size },
      { findingCount: findings.length, pi },
      'data-exfiltration-sentinel-v1',
    );

    if (findings.length > 0) {
      await this.signalSwarm('data_exfiltration.suspicious_flow_found', {
        botId: this.botId,
        count: findings.length,
      });
    }

    return { findings, flowsChecked: flows.length };
  }
}
