/**
 * platform/aegis-swarm/src/bots/secrets-exposure-detector.ts
 *
 * D-16 — Secrets Exposure Detector.
 *
 * Walks a directory tree looking for hardcoded credentials using known
 * structural patterns (AWS keys, GitHub tokens, private key headers,
 * etc.). Detection only — never modifies files.
 *
 * CRITICAL: the actual matched secret value is NEVER included in a
 * Finding, a Decision, a log line, or a swarm signal. Only the pattern
 * name and file:line location are recorded. Recording the real secret
 * would mean this tool leaks exactly what it exists to catch.
 */

import fs from 'fs';
import path from 'path';
import { CrystalBot, Finding } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';

interface SecretPattern {
  name: string;
  regex: RegExp;
  sev: Finding['sev'];
}

// Structural patterns only — matched by shape, not by trying to guess
// arbitrary "looks like a password" strings, to keep false positives low.
const SECRET_PATTERNS: SecretPattern[] = [
  { name: 'AWS Access Key ID', regex: /AKIA[0-9A-Z]{16}/, sev: 'block' },
  { name: 'GitHub Token', regex: /gh[pousr]_[A-Za-z0-9]{36,}/, sev: 'block' },
  { name: 'Stripe Live Secret Key', regex: /sk_live_[0-9a-zA-Z]{20,}/, sev: 'block' },
  { name: 'Slack Token', regex: /xox[baprs]-[0-9A-Za-z-]{10,}/, sev: 'block' },
  {
    name: 'Private Key Header',
    regex: /-----BEGIN (RSA |EC |OPENSSH |DSA |)PRIVATE KEY-----/,
    sev: 'block',
  },
  {
    name: 'Hardcoded Password Assignment',
    regex: /(password|passwd|pwd)\s*[:=]\s*['"][^'"]{4,}['"]/i,
    sev: 'warn',
  },
  {
    name: 'Hardcoded API/Secret Key Assignment',
    regex: /(api[_-]?key|secret[_-]?key)\s*[:=]\s*['"][A-Za-z0-9_-]{16,}['"]/i,
    sev: 'warn',
  },
];

const EXCLUDED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next']);
const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024; // skip anything over 2MB (binaries, bundles)

export interface SecretsScanReport {
  findings: Finding[];
  filesScanned: number;
  secretsFound: number;
}

export class SecretsExposureDetectorBot extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async scanDirectory(rootDir: string): Promise<SecretsScanReport> {
    await this.enforcePermission('read:filesystem');

    const files = this.walkFiles(rootDir);
    const allFindings: Finding[] = [];

    for (const filePath of files) {
      const relPath = path.relative(rootDir, filePath);
      const findings = this.scanFile(filePath, relPath);
      allFindings.push(...findings);
    }

    const pi = this.computePI(allFindings);

    // Decision input/output intentionally contains counts and locations
    // only — never the matched secret text.
    await this.createDecision(
      { rootDir, filesScanned: files.length },
      { findingCount: allFindings.length, pi },
      'secret-pattern-v1',
    );

    const blockCount = allFindings.filter((f) => f.sev === 'block').length;
    if (blockCount > 0) {
      await this.signalSwarm('secrets.exposure_found', {
        botId: this.botId,
        blockSeverityCount: blockCount,
      });
    }

    return {
      findings: allFindings,
      filesScanned: files.length,
      secretsFound: allFindings.length,
    };
  }

  /**
   * Exposed separately so pattern-matching logic can be tested against
   * in-memory content without touching the real filesystem.
   */
  scanFileContent(content: string, relPath: string): Finding[] {
    const findings: Finding[] = [];
    const lines = content.split('\n');

    lines.forEach((line, index) => {
      for (const pattern of SECRET_PATTERNS) {
        if (pattern.regex.test(line)) {
          findings.push({
            cat: 'sec',
            sev: pattern.sev,
            loc: `${relPath}:${index + 1}`,
            desc: `Potential ${pattern.name} detected`,
            rec:
              pattern.sev === 'block'
                ? 'Rotate this credential immediately and move it to a secrets manager (Vault/KMS). Treat as compromised if this file was ever committed.'
                : 'Move this value to an environment variable or secrets manager rather than hardcoding it.',
          });
        }
      }
    });

    return findings;
  }

  private scanFile(filePath: string, relPath: string): Finding[] {
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > MAX_FILE_SIZE_BYTES) return [];
      const content = fs.readFileSync(filePath, 'utf-8');
      return this.scanFileContent(content, relPath);
    } catch {
      // Unreadable or binary file — skip rather than fail the whole scan.
      return [];
    }
  }

  private walkFiles(rootDir: string): string[] {
    const results: string[] = [];

    const walk = (dir: string) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (!EXCLUDED_DIRS.has(entry.name)) {
            walk(path.join(dir, entry.name));
          }
        } else if (entry.isFile()) {
          results.push(path.join(dir, entry.name));
        }
      }
    };

    walk(rootDir);
    return results;
  }
}
