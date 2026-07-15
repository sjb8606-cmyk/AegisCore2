/**
 * platform/aegis-swarm/src/bots/dependency-vuln-scanner.ts
 *
 * D-06 — Dependency Vulnerability Scanner.
 *
 * Runs `npm audit --json` against a target directory and converts the
 * results into the swarm's standard Finding format. Detection only —
 * never modifies package.json, package-lock.json, or node_modules.
 * Fixing is a separate bot's job, gated by human approval.
 */

import { exec } from 'child_process';
import { CrystalBot, Finding } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';

interface NpmAuditVulnerability {
  name: string;
  severity: 'info' | 'low' | 'moderate' | 'high' | 'critical';
  range?: string;
  nodes?: string[];
  fixAvailable?: boolean | Record<string, unknown>;
}

interface NpmAuditReport {
  vulnerabilities?: Record<string, NpmAuditVulnerability>;
}

// npm's 5-tier severity mapped onto the swarm's 4-tier Finding scale.
const SEVERITY_MAP: Record<NpmAuditVulnerability['severity'], Finding['sev']> = {
  critical: 'block',
  high: 'crit',
  moderate: 'warn',
  low: 'info',
  info: 'info',
};

export interface DependencyScanReport {
  findings: Finding[];
  packagesScanned: number;
  vulnerablePackages: number;
}

export class DependencyVulnScannerBot extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  /**
   * Runs a real scan against `cwd`, records a decision, and signals the
   * swarm if anything critical/high turns up.
   */
  async scanDirectory(cwd: string): Promise<DependencyScanReport> {
    await this.enforcePermission('exec:npm-audit');

    const raw = await this.runNpmAudit(cwd);
    const findings = this.parseAuditReport(raw);
    const pi = this.computePI(findings);

    await this.createDecision({ cwd }, { findings, pi }, 'npm-audit-v1');

    const criticalCount = findings.filter((f) => f.sev === 'block').length;
    const highCount = findings.filter((f) => f.sev === 'crit').length;

    if (criticalCount > 0 || highCount > 0) {
      await this.signalSwarm('dependency.vulnerability_found', {
        botId: this.botId,
        critical: criticalCount,
        high: highCount,
      });
    }

    return {
      findings,
      packagesScanned: raw.vulnerabilities ? Object.keys(raw.vulnerabilities).length : 0,
      vulnerablePackages: findings.length,
    };
  }

  /**
   * Exposed separately from scanDirectory so parsing logic can be tested
   * against fixture data without shelling out to a real process.
   */
  parseAuditReport(report: NpmAuditReport): Finding[] {
    const vulnerabilities = report.vulnerabilities ?? {};
    return Object.values(vulnerabilities).map((vuln) => {
      const fixAvailable = Boolean(vuln.fixAvailable);
      return {
        cat: 'sec' as const,
        sev: SEVERITY_MAP[vuln.severity] ?? 'warn',
        loc: vuln.nodes?.[0] ?? vuln.name,
        desc: `${vuln.severity} severity vulnerability in "${vuln.name}"${
          vuln.range ? ` (${vuln.range})` : ''
        }`,
        rec: fixAvailable
          ? 'Run `npm audit fix` (or `npm audit fix --force` if a breaking change is required) after human review.'
          : 'No automated fix available yet — requires manual review or an upstream patch.',
      };
    });
  }

  private runNpmAudit(cwd: string): Promise<NpmAuditReport> {
    return new Promise((resolve, reject) => {
      exec(
        'npm audit --json',
        { cwd, maxBuffer: 1024 * 1024 * 10 },
        (error, stdout) => {
          // npm audit exits non-zero when vulnerabilities are found —
          // that's expected, not a failure. stdout still has valid JSON.
          if (stdout) {
            try {
              resolve(JSON.parse(stdout) as NpmAuditReport);
              return;
            } catch (parseErr) {
              reject(parseErr);
              return;
            }
          }
          reject(error ?? new Error('npm audit produced no output'));
        },
      );
    });
  }
}
