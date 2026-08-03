/**
 * platform/aegis-swarm/src/bots/runtime-agent-monitor.ts
 *
 * D-18 — Runtime Agent Monitor.
 *
 * "Monitors agent resource consumption" is genuinely, fully buildable
 * today — Node's process.memoryUsage()/process.cpuUsage() are real,
 * native, always-available APIs, no external infrastructure needed at
 * all (unlike most of tonight's bots, nothing here is stubbed).
 *
 * Two distinct check types, same "don't double-flag" composition
 * pattern as D-15:
 * - A hard absolute ceiling check (new, real, distinct) — catches a
 *   runaway agent immediately even with zero baseline history.
 * - Statistical baseline deviation, reusing D-07's exact
 *   computeBaseline()/scoreAgainstBaseline() functions rather than
 *   reimplementing them (third bot doing this tonight, after D-15).
 *
 * If a metric already exceeds its hard ceiling, it is not also
 * baseline-checked — the ceiling finding is the more direct, more
 * serious signal; double-flagging the same metric would be noise.
 */

import { CrystalBot, Finding } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { computeBaseline, scoreAgainstBaseline } from './behavioral-anomaly-detector';

export interface ResourceSnapshot {
  heapUsedBytes: number;
  rssBytes: number;
  cpuUserMicros: number;
}

export interface ResourceCeilings {
  maxHeapUsedBytes?: number;
  maxRssBytes?: number;
}

export interface ResourceBaselines {
  heapUsedBytes?: number[];
  rssBytes?: number[];
}

export interface ResourceMonitorReport {
  findings: Finding[];
  agentBotId: string;
}

export function captureResourceSnapshot(): ResourceSnapshot {
  const mem = process.memoryUsage();
  const cpu = process.cpuUsage();
  return {
    heapUsedBytes: mem.heapUsed,
    rssBytes: mem.rss,
    cpuUserMicros: cpu.user,
  };
}

export class RuntimeAgentMonitorBot extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async monitorAgent(
    agentBotId: string,
    snapshot: ResourceSnapshot,
    ceilings?: ResourceCeilings,
    baselines?: ResourceBaselines,
  ): Promise<ResourceMonitorReport> {
    await this.enforcePermission('read:process-resources');

    const findings: Finding[] = [];

    this.checkMetric(
      findings,
      agentBotId,
      'heapUsedBytes',
      snapshot.heapUsedBytes,
      ceilings?.maxHeapUsedBytes,
      baselines?.heapUsedBytes,
    );
    this.checkMetric(
      findings,
      agentBotId,
      'rssBytes',
      snapshot.rssBytes,
      ceilings?.maxRssBytes,
      baselines?.rssBytes,
    );

    const pi = this.computePI(findings);

    await this.createDecision(
      { agentBotId, snapshot },
      { findingCount: findings.length, pi },
      'runtime-agent-monitor-v1',
    );

    if (findings.length > 0) {
      await this.signalSwarm('runtime_agent_monitor.resource_issue_found', {
        botId: this.botId,
        agentBotId,
        count: findings.length,
      });
    }

    return { findings, agentBotId };
  }

  private checkMetric(
    findings: Finding[],
    agentBotId: string,
    metricName: string,
    value: number,
    ceiling: number | undefined,
    baselineSamples: number[] | undefined,
  ): void {
    if (ceiling !== undefined && value > ceiling) {
      findings.push({
        cat: 'sec',
        sev: 'block',
        loc: `${agentBotId}:${metricName}`,
        desc: `${agentBotId}'s ${metricName} (${value}) exceeds its hard ceiling (${ceiling})`,
        rec: 'A runaway or misbehaving agent process can be a real availability or cost risk. Investigate immediately — this may warrant suspending the agent.',
      });
      return;
    }

    if (baselineSamples && baselineSamples.length >= 2) {
      const baseline = computeBaseline(baselineSamples);
      const result = scoreAgainstBaseline(baseline, value);
      if (result.isAnomaly) {
        findings.push({
          cat: 'sec',
          sev: 'crit',
          loc: `${agentBotId}:${metricName}`,
          desc: `${agentBotId}'s ${metricName} (${value}) deviates from its established baseline (z-score ${result.zScore.toFixed(2)})`,
          rec: 'Confirm this is expected (e.g. a genuinely heavier workload) rather than a leak or misbehavior.',
        });
      }
    }
  }
}
