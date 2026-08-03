/**
 * platform/aegis-swarm/src/bots/hardcoded-privilege-override-detector.ts
 *
 * D-26 — Hardcoded Privilege Override Detector.
 *
 * Flags code that special-cases one specific tenant/user by hardcoding
 * their identifier directly into an equality/inclusion check, rather
 * than driving access from role/permission data. This is deliberately
 * narrower than "any comparison against a string literal" — comparing
 * a role to a role NAME (e.g. role === 'admin') is completely normal,
 * legitimate RBAC code and must not be flagged. What's actually
 * suspicious is hardcoding one *individual's* identity (a UUID or an
 * email address) as an always-allowed special case, since that's the
 * shape a real backdoor takes — a specific person, not a role.
 *
 * Scoped to .ts/.js only, same rationale as D-24/D-25. Detection only.
 */

import fs from 'fs';
import path from 'path';
import { CrystalBot, Finding } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';

// Identity-ish variable names worth watching. Deliberately excludes
// role/permission/scope — comparing those to a literal name is normal
// authorization logic, not a hardcoded individual override.
const IDENTITY_VAR = '(?:tenantId|userId|ownerId|accountId|requesterId|adminId|sub)';

const UUID_LITERAL = `['"][0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}['"]`;
const EMAIL_LITERAL = `['"][^'"\\s]+@[^'"\\s]+\\.[^'"\\s]+['"]`;
const SPECIFIC_IDENTITY_LITERAL = `(?:${UUID_LITERAL}|${EMAIL_LITERAL})`;

interface OverridePattern {
  name: string;
  regex: RegExp;
}

const OVERRIDE_PATTERNS: OverridePattern[] = [
  {
    name: 'Identity variable compared directly to a hardcoded individual ID',
    regex: new RegExp(`${IDENTITY_VAR}\\s*===?\\s*${SPECIFIC_IDENTITY_LITERAL}`, 'i'),
  },
  {
    name: 'Hardcoded individual ID compared directly to an identity variable',
    regex: new RegExp(`${SPECIFIC_IDENTITY_LITERAL}\\s*===?\\s*${IDENTITY_VAR}`, 'i'),
  },
  {
    name: 'Identity variable checked via .includes() against a hardcoded individual ID',
    regex: new RegExp(`${IDENTITY_VAR}\\.includes\\(${SPECIFIC_IDENTITY_LITERAL}\\)`, 'i'),
  },
];

const SCANNABLE_EXTENSIONS = new Set(['.ts', '.js']);
const EXCLUDED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next']);
const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;

export interface PrivilegeOverrideScanReport {
  findings: Finding[];
  filesScanned: number;
  overridesFound: number;
}

export class HardcodedPrivilegeOverrideDetectorBot extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async scanDirectory(rootDir: string): Promise<PrivilegeOverrideScanReport> {
    await this.enforcePermission('read:filesystem');

    const files = this.walkFiles(rootDir);
    const allFindings: Finding[] = [];

    for (const filePath of files) {
      const relPath = path.relative(rootDir, filePath);
      allFindings.push(...this.scanFile(filePath, relPath));
    }

    const pi = this.computePI(allFindings);

    await this.createDecision(
      { rootDir, filesScanned: files.length },
      { findingCount: allFindings.length, pi },
      'hardcoded-privilege-override-v1',
    );

    if (allFindings.length > 0) {
      await this.signalSwarm('privilege_override.found', {
        botId: this.botId,
        count: allFindings.length,
      });
    }

    return {
      findings: allFindings,
      filesScanned: files.length,
      overridesFound: allFindings.length,
    };
  }

  scanFileContent(content: string, relPath: string): Finding[] {
    const findings: Finding[] = [];
    const lines = content.split('\n');

    lines.forEach((rawLine, index) => {
      const line = rawLine.trim();
      if (line.startsWith('//') || line.startsWith('*')) return;

      for (const pattern of OVERRIDE_PATTERNS) {
        if (pattern.regex.test(rawLine)) {
          findings.push({
            cat: 'sec',
            sev: 'crit',
            loc: `${relPath}:${index + 1}`,
            desc: pattern.name,
            rec: 'Hardcoding one specific tenant/user ID as an always-allowed case is a common backdoor shape. Drive access from role/permission data instead; if a genuine system-level identity is needed, use an env-configured constant (see SYSTEM_TENANT_ID in bot-runtime) rather than an inline literal, and have a human confirm intent either way.',
          });
        }
      }
    });

    return findings;
  }

  private scanFile(filePath: string, relPath: string): Finding[] {
    if (!SCANNABLE_EXTENSIONS.has(path.extname(filePath))) return [];
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > MAX_FILE_SIZE_BYTES) return [];
      const content = fs.readFileSync(filePath, 'utf-8');
      return this.scanFileContent(content, relPath);
    } catch {
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
          if (!EXCLUDED_DIRS.has(entry.name)) walk(path.join(dir, entry.name));
        } else if (entry.isFile() && SCANNABLE_EXTENSIONS.has(path.extname(entry.name))) {
          results.push(path.join(dir, entry.name));
        }
      }
    };

    walk(rootDir);
    return results;
  }
}
