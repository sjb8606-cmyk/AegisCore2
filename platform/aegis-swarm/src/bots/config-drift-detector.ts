/**
 * platform/aegis-swarm/src/bots/config-drift-detector.ts
 *
 * D-20 — Configuration Drift Detector.
 *
 * Compares the current state of a config directory against a stored
 * baseline of file hashes. Two distinct actions:
 *  - detectDrift: read-only comparison, safe to run on a schedule.
 *  - recordBaseline: WRITES a new baseline file. Intended for manual,
 *    human-initiated use only when a human is deliberately accepting
 *    the current state as "known good" — never wire this to a
 *    scheduled trigger.
 */

import fs from 'fs';
import { CrystalBot, Finding } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { hashDirectory } from '../lib/hash-directory';

export interface DriftReport {
  findings: Finding[];
  filesChecked: number;
}

export class ConfigDriftDetectorBot extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async detectDrift(configDir: string, baselinePath: string): Promise<DriftReport> {
    await this.enforcePermission('read:filesystem');
    await this.enforcePermission('read:config-baseline');

    if (!fs.existsSync(baselinePath)) {
      const findings: Finding[] = [
        {
          cat: 'proc',
          sev: 'warn',
          loc: baselinePath,
          desc: 'No baseline file found — drift cannot be verified until recordBaseline is run.',
          rec: 'Have a human review the current config state, then run recordBaseline to establish a known-good baseline.',
        },
      ];
      await this.createDecision({ configDir, baselinePath }, { findings }, 'config-drift-v1');
      return { findings, filesChecked: 0 };
    }

    const baseline: Record<string, string> = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'));
    const currentHashes = hashDirectory(configDir);
    const findings: Finding[] = [];

    for (const [relPath, baselineHash] of Object.entries(baseline)) {
      const currentHash = currentHashes[relPath];
      if (currentHash === undefined) {
        findings.push({
          cat: 'proc',
          sev: 'block',
          loc: relPath,
          desc: 'Baseline config file is missing — deleted or moved since baseline was recorded.',
          rec: 'Confirm whether this removal was intentional. If not, restore the file from version control immediately.',
        });
      } else if (currentHash !== baselineHash) {
        findings.push({
          cat: 'proc',
          sev: 'crit',
          loc: relPath,
          desc: 'Configuration drift detected — file has changed since the baseline was recorded.',
          rec: 'Review the change against version control history. If intentional, run recordBaseline to accept the new state.',
        });
      }
    }

    for (const relPath of Object.keys(currentHashes)) {
      if (!(relPath in baseline)) {
        findings.push({
          cat: 'proc',
          sev: 'warn',
          loc: relPath,
          desc: 'New config file present that is not in the baseline.',
          rec: 'If this file is intentional, run recordBaseline to include it going forward.',
        });
      }
    }

    const pi = this.computePI(findings);
    await this.createDecision(
      { configDir, baselinePath },
      { findingCount: findings.length, pi },
      'config-drift-v1',
    );

    const severeCount = findings.filter((f) => f.sev === 'block' || f.sev === 'crit').length;
    if (severeCount > 0) {
      await this.signalSwarm('config.drift_detected', { botId: this.botId, severeCount });
    }

    return { findings, filesChecked: Object.keys(currentHashes).length };
  }

  async recordBaseline(configDir: string, baselinePath: string): Promise<{ filesRecorded: number }> {
    await this.enforcePermission('write:config-baseline');

    const hashes = hashDirectory(configDir);
    fs.writeFileSync(baselinePath, JSON.stringify(hashes, null, 2), 'utf-8');

    await this.createDecision(
      { configDir, baselinePath },
      { filesRecorded: Object.keys(hashes).length },
      'config-drift-v1',
    );

    return { filesRecorded: Object.keys(hashes).length };
  }
}
