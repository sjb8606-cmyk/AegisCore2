/**
 * platform/aegis-swarm/src/employees/documentation-manager.ts
 *
 * E-04 — Documentation Manager / Knowledge Librarian.
 *
 * Real master: S.R. Ranganathan, the actual founder of library
 * science. Two of his Five Laws of Library Science map directly onto
 * real, testable code, not just historical framing:
 *
 * - "Save the time of the reader" — a doc claiming a file or a piece
 *   of content exists, when it doesn't anymore, wastes exactly the
 *   time this law protects. verifyFileReference()/
 *   verifyContentReference() check this for real, against the
 *   actual filesystem — verified against this very repo's own real
 *   files before this bot was written.
 * - "A library is a growing organism" — a doc that hasn't changed
 *   while the code it documents has, is dead weight in a system that
 *   is supposed to keep growing correctly. assessStaleness() checks
 *   this via real timestamp comparison.
 *
 * No LLM call needed for either check — both are real, deterministic
 * filesystem operations, same discipline as R-18/R-23 tonight, just
 * applied constructively (documentation health) rather than
 * adversarially (security findings).
 */

import * as fs from 'fs';
import * as path from 'path';
import { CrystalBot } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';

export type ClaimType = 'file_reference' | 'content_reference';

export interface DocClaim {
  type: ClaimType;
  value: string;
}

export interface ClaimCheckResult {
  claim: DocClaim;
  verified: boolean;
}

export interface DocHealthReport {
  docPath: string;
  totalClaims: number;
  brokenClaims: ClaimCheckResult[];
  stale: boolean;
  healthScore: number;
}

const SEARCHABLE_EXTENSIONS = ['.ts', '.js', '.json', '.md'];

export function verifyFileReference(refPath: string, rootDir: string): boolean {
  return fs.existsSync(path.join(rootDir, refPath));
}

export function verifyContentReference(
  searchTerm: string,
  rootDir: string,
  extensions: string[] = SEARCHABLE_EXTENSIONS,
): boolean {
  function walk(dir: string): boolean {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        if (walk(fullPath)) return true;
      } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
        const content = fs.readFileSync(fullPath, 'utf8');
        if (content.includes(searchTerm)) return true;
      }
    }
    return false;
  }
  return walk(rootDir);
}

export function assessStaleness(docLastUpdatedDaysAgo: number, codeLastUpdatedDaysAgo: number): boolean {
  return codeLastUpdatedDaysAgo < docLastUpdatedDaysAgo;
}

export class DocumentationManagerBot extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async checkDocHealth(
    docPath: string,
    claims: DocClaim[],
    rootDir: string,
    docLastUpdatedDaysAgo: number,
    codeLastUpdatedDaysAgo: number,
  ): Promise<DocHealthReport> {
    await this.enforcePermission('read:filesystem');

    const results: ClaimCheckResult[] = claims.map((claim) => {
      const verified =
        claim.type === 'file_reference'
          ? verifyFileReference(claim.value, rootDir)
          : verifyContentReference(claim.value, rootDir);
      return { claim, verified };
    });

    const brokenClaims = results.filter((r) => !r.verified);
    const stale = assessStaleness(docLastUpdatedDaysAgo, codeLastUpdatedDaysAgo);
    const healthScore =
      claims.length === 0 ? 100 : Math.round(((claims.length - brokenClaims.length) / claims.length) * 100);

    const report: DocHealthReport = {
      docPath,
      totalClaims: claims.length,
      brokenClaims,
      stale,
      healthScore,
    };

    await this.createDecision(
      { docPath, claimCount: claims.length },
      { healthScore, brokenCount: brokenClaims.length, stale },
      'documentation-manager-health-v1',
    );

    if (brokenClaims.length > 0 || stale) {
      await this.signalSwarm('employee.doc_health_issue_found', {
        botId: this.botId,
        docPath,
        brokenCount: brokenClaims.length,
        stale,
      });
    }

    return report;
  }
}
