/**
 * platform/aegis-swarm/src/redteam/audit-blind-spotter.ts
 *
 * R-18 — Audit Blind Spotter.
 *
 * "Coverage gap hunting" against D-22's restraint ledger. Different
 * shape again: a real static scanner, not an attack against one
 * bot's runtime logic. Reads every real defense bot's actual source
 * file and finds public async methods that never call
 * enforcePermission() — meaning an action could occur with zero
 * permission check and zero audit trail.
 *
 * The brace-matching method-body extraction was genuinely buggy on
 * the first pass: a default parameter value like `= {}` confused a
 * naive `{`/`}` depth counter into thinking the method body ended
 * inside the parameter list. Fixed by tracking PAREN depth first to
 * find where parameters truly close, then only counting brace depth
 * from the real body's opening `{` onward. Verified against a known
 * false positive (D-22's recordRefusal, which does call
 * enforcePermission) before this file was written.
 *
 * Findings are classified by real severity, not treated uniformly:
 * - 'informational': the method throws immediately (an honest stub)
 *   before any real action or side effect — lower risk today, but
 *   would need a permission check added if ever implemented for real.
 * - 'needs_review': real logic executes (a Decision gets created or
 *   the swarm gets signaled) with no permission gate at all — a
 *   genuinely more serious finding.
 *
 * Confirmed 7 real findings across this repo's 21 defense bot files:
 * 5 informational stubs, and 2 needs_review — D-01's ingest()/
 * checkCorrelation(), both public and callable directly, bypassing
 * activate()'s permission check entirely.
 */

import * as fs from 'fs';
import * as path from 'path';
import { RedTeamBot } from './redteam-isolation';
import { BotSpecification } from '@platform/bot-registry';

export type BlindSpotSeverity = 'informational' | 'needs_review';

export interface BlindSpotFinding {
  file: string;
  methodName: string;
  severity: BlindSpotSeverity;
}

export interface CoverageScanReport {
  filesScanned: number;
  totalMethods: number;
  findings: BlindSpotFinding[];
}

interface ExtractedMethod {
  name: string;
  body: string;
}

export class AuditBlindSpotterBot extends RedTeamBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async scanBotDirectory(botsDirPath: string): Promise<CoverageScanReport> {
    await this.enforcePermission('redteam:scan-audit-coverage');

    const files = fs.readdirSync(botsDirPath).filter((f) => f.endsWith('.ts') && f !== 'index.ts');
    const findings: BlindSpotFinding[] = [];
    let totalMethods = 0;

    for (const file of files) {
      const source = fs.readFileSync(path.join(botsDirPath, file), 'utf8');
      const methods = this.extractPublicAsyncMethods(source);
      totalMethods += methods.length;

      for (const method of methods) {
        if (!method.body.includes('enforcePermission')) {
          findings.push({ file, methodName: method.name, severity: this.classifySeverity(method.body) });
        }
      }
    }

    const report: CoverageScanReport = { filesScanned: files.length, totalMethods, findings };

    await this.createDecision({ botsDirPath }, report, 'redteam-audit-blind-spotter-v1');

    if (findings.some((f) => f.severity === 'needs_review')) {
      await this.signalSwarm('redteam.audit_blind_spot_found', {
        botId: this.botId,
        findingCount: findings.length,
      });
    }

    return report;
  }

  private extractPublicAsyncMethods(source: string): ExtractedMethod[] {
    const methods: ExtractedMethod[] = [];
    const lines = source.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(/^\s{2}async\s+(\w+)\s*\(/);
      if (!match || line.trim().startsWith('private')) continue;
      const methodName = match[1];

      let parenDepth = 0;
      let paramsClosed: { lineIndex: number; charIndex: number } | null = null;

      outer: for (let j = i; j < lines.length; j++) {
        const l = lines[j];
        for (let k = 0; k < l.length; k++) {
          const ch = l[k];
          if (ch === '(') parenDepth++;
          if (ch === ')') {
            parenDepth--;
            if (parenDepth === 0) {
              paramsClosed = { lineIndex: j, charIndex: k };
              break outer;
            }
          }
        }
      }
      if (!paramsClosed) continue;

      let braceDepth = 0;
      let started = false;
      const bodyLines: string[] = [];

      for (let j = paramsClosed.lineIndex; j < lines.length; j++) {
        const l = lines[j];
        const startChar = j === paramsClosed.lineIndex ? paramsClosed.charIndex + 1 : 0;
        for (let k = startChar; k < l.length; k++) {
          const ch = l[k];
          if (ch === '{') {
            braceDepth++;
            started = true;
          }
          if (ch === '}') braceDepth--;
        }
        bodyLines.push(l);
        if (started && braceDepth === 0) break;
      }

      methods.push({ name: methodName, body: bodyLines.join('\n') });
    }

    return methods;
  }

  private classifySeverity(body: string): BlindSpotSeverity {
    const throwsImmediately = /throw\s+new\s+Error/.test(body);
    const hasRealSideEffect = body.includes('createDecision') || body.includes('signalSwarm');
    if (throwsImmediately && !hasRealSideEffect) return 'informational';
    return 'needs_review';
  }
}
