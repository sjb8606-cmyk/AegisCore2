/**
 * platform/aegis-swarm/src/bots/tenant-scoping-bypass-detector.ts
 *
 * D-25 — RLS/Tenant Scoping Bypass Detector.
 *
 * Flags the exact real bug found and fixed across 89 files in this
 * repo: tenantId/userId sourced from a raw client-supplied header
 * (x-tenant-id / x-user-id) instead of the JWT-verified req.auth
 * context. See platform/tenancy/src/resolver.ts for the corrected
 * pattern and its own comment warning against the buggy one.
 *
 * Scoped to .ts/.js only — deliberately skips JSON, same rationale as
 * D-24: this is about real application code, not config/content files.
 * Detection only — never modifies files.
 */

import fs from 'fs';
import path from 'path';
import { CrystalBot, Finding } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';

interface HeaderPattern {
  name: string;
  regex: RegExp;
}

const HEADER_PATTERNS: HeaderPattern[] = [
  {
    name: 'Raw x-tenant-id header used for tenant identity',
    regex: /req(?:uest)?\.(?:headers(?:\.get\(|\[)|header\()['"]x-tenant-id['"]/i,
  },
  {
    name: 'Raw x-user-id header used for user identity',
    regex: /req(?:uest)?\.(?:headers(?:\.get\(|\[)|header\()['"]x-user-id['"]/i,
  },
];

const SCANNABLE_EXTENSIONS = new Set(['.ts', '.js']);
const EXCLUDED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next']);
const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;

export interface TenantScopingScanReport {
  findings: Finding[];
  filesScanned: number;
  bypassesFound: number;
}

export class TenantScopingBypassDetectorBot extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async scanDirectory(rootDir: string): Promise<TenantScopingScanReport> {
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
      'tenant-scoping-bypass-v1',
    );

    if (allFindings.length > 0) {
      await this.signalSwarm('tenant_scoping.bypass_found', {
        botId: this.botId,
        count: allFindings.length,
      });
    }

    return {
      findings: allFindings,
      filesScanned: files.length,
      bypassesFound: allFindings.length,
    };
  }

  scanFileContent(content: string, relPath: string): Finding[] {
    const findings: Finding[] = [];
    const lines = content.split('\n');

    lines.forEach((rawLine, index) => {
      const line = rawLine.trim();
      if (line.startsWith('//') || line.startsWith('*')) return;

      for (const pattern of HEADER_PATTERNS) {
        if (pattern.regex.test(rawLine)) {
          findings.push({
            cat: 'sec',
            sev: 'block',
            loc: `${relPath}:${index + 1}`,
            desc: pattern.name,
            rec: 'Never derive tenantId/userId from client-supplied headers. Use req.auth.tenantId / req.auth.sub from the JWT-verified context set by requireAuth() — see platform/tenancy/src/resolver.ts for the correct pattern.',
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
