/**
 * platform/aegis-swarm/src/employees/code-reviewer.ts
 *
 * E-07 — Code Reviewer / QA Engineer.
 *
 * Same real-static-scan discipline as R-18 earlier tonight, applied
 * constructively: genuine pattern detection against real files, not
 * a fabricated LLM judgment call about code quality. Every check
 * here is a concrete, checkable signal — verified against a real,
 * already-clean file from tonight's own build (zero false positives)
 * and a synthetic fixture with known planted issues (all three real
 * issues caught) before implementation.
 *
 * Three real checks:
 * - Unfinished markers (TODO/FIXME/XXX) left in real code
 * - console.log/console.debug calls left in, that should go through
 *   a real logger instead
 * - Long functions (over 60 lines) — a real, if blunt, complexity
 *   signal, using the same brace-depth extraction technique as R-18
 *
 * This is a real second-pass reviewer for exactly the mechanical
 * things a fast solo-founder pace tends to leave behind — not a
 * substitute for actual code review judgment, which needs a live LLM.
 */

import * as fs from 'fs';
import * as path from 'path';
import { CrystalBot } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';

const LONG_FUNCTION_THRESHOLD_LINES = 60;

export interface CodeReviewFinding {
  file: string;
  type: 'unfinished_marker' | 'console_log_left_in' | 'long_function';
  line: number;
  detail: string;
}

export function scanFileContent(fileName: string, content: string): CodeReviewFinding[] {
  const lines = content.split('\n');
  const findings: CodeReviewFinding[] = [];

  lines.forEach((line, i) => {
    if (/\b(TODO|FIXME|XXX)\b/.test(line)) {
      findings.push({ file: fileName, type: 'unfinished_marker', line: i + 1, detail: line.trim() });
    }
    if (/console\.(log|debug)\(/.test(line)) {
      findings.push({ file: fileName, type: 'console_log_left_in', line: i + 1, detail: line.trim() });
    }
  });

  const funcMatches = [...content.matchAll(/^\s{2}(?:async\s+)?(\w+)\s*\([^)]*\)[^{]*\{/gm)];
  for (const match of funcMatches) {
    const startLine = content.slice(0, match.index).split('\n').length;
    let depth = 0;
    let started = false;
    let endLine = startLine;
    for (let i = startLine - 1; i < lines.length; i++) {
      for (const ch of lines[i]) {
        if (ch === '{') {
          depth++;
          started = true;
        }
        if (ch === '}') depth--;
      }
      if (started && depth === 0) {
        endLine = i + 1;
        break;
      }
    }
    const length = endLine - startLine;
    if (length > LONG_FUNCTION_THRESHOLD_LINES) {
      findings.push({
        file: fileName,
        type: 'long_function',
        line: startLine,
        detail: `${match[1]} is ${length} lines (over ${LONG_FUNCTION_THRESHOLD_LINES})`,
      });
    }
  }

  return findings;
}

export interface CodeReviewReport {
  filesScanned: number;
  findings: CodeReviewFinding[];
}

export class CodeReviewerBot extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async reviewDirectory(dirPath: string): Promise<CodeReviewReport> {
    await this.enforcePermission('read:filesystem');

    const files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.ts'));
    const findings: CodeReviewFinding[] = [];

    for (const file of files) {
      const content = fs.readFileSync(path.join(dirPath, file), 'utf8');
      findings.push(...scanFileContent(file, content));
    }

    const report: CodeReviewReport = { filesScanned: files.length, findings };

    await this.createDecision({ dirPath, fileCount: files.length }, { findingCount: findings.length }, 'code-reviewer-v1');

    if (findings.length > 0) {
      await this.signalSwarm('employee.code_review_findings', { botId: this.botId, findingCount: findings.length });
    }

    return report;
  }
}
