/**
 * platform/aegis-swarm/src/redteam/database-boundary-tester.ts
 *
 * R-23 — Database Boundary Tester.
 *
 * "RLS bypass attempts." Same shape as R-13: one real, statically
 * verifiable finding, plus one honest stub for the part that
 * genuinely requires a live database.
 *
 * scanForUnverifiedTenantId() is real static analysis, confirming
 * something significant: every function across this repo's three new
 * RLS-table store modules (purge-store.ts, incident-store.ts,
 * restraint-store.ts) accepts `tenantId: string` as a bare, unverified
 * parameter — the exact same class of bug already found and fixed
 * elsewhere in this repo tonight (89 files trusting a raw client
 * header instead of the JWT-verified context). RLS itself is sound —
 * Postgres will correctly isolate tenant A from tenant B's rows — but
 * that protection only holds if the RIGHT tenantId reaches these
 * functions in the first place. Nothing here verifies that. This
 * isn't yet exploitable (nothing currently calls these functions from
 * a live, untrusted HTTP route — that wiring doesn't exist yet), but
 * it's a real contract that must be enforced by whatever eventually
 * calls these functions: tenantId must come from verified auth
 * context, never from client input.
 *
 * attemptCrossTenantRead() is an honest stub. Actually proving RLS
 * enforcement holds under a real cross-tenant read attempt requires a
 * live Postgres connection with real RLS policies active — not
 * available in this sandbox.
 */

import * as fs from 'fs';
import * as path from 'path';
import { RedTeamBot } from './redteam-isolation';
import { BotSpecification } from '@platform/bot-registry';

export interface UnverifiedTenantIdFinding {
  file: string;
  functionName: string;
}

export interface TenantBoundaryScanReport {
  filesScanned: number;
  findings: UnverifiedTenantIdFinding[];
}

export class DatabaseBoundaryTesterBot extends RedTeamBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async scanForUnverifiedTenantId(libDirPath: string): Promise<TenantBoundaryScanReport> {
    await this.enforcePermission('redteam:scan-database-boundary');

    const files = fs.readdirSync(libDirPath).filter((f) => f.endsWith('.ts'));
    const findings: UnverifiedTenantIdFinding[] = [];

    for (const file of files) {
      const source = fs.readFileSync(path.join(libDirPath, file), 'utf8');
      for (const functionName of this.findFunctionsWithBareTenantId(source)) {
        findings.push({ file, functionName });
      }
    }

    const report: TenantBoundaryScanReport = { filesScanned: files.length, findings };

    await this.createDecision({ libDirPath }, report, 'redteam-database-boundary-tester-v1');

    if (findings.length > 0) {
      await this.signalSwarm('redteam.unverified_tenant_id_found', {
        botId: this.botId,
        findingCount: findings.length,
      });
    }

    return report;
  }

  async attemptCrossTenantRead(): Promise<never> {
    throw new Error(
      'Live cross-tenant RLS testing is not available yet: this environment has no live Postgres ' +
        'connection to run a real cross-tenant read attempt against actual RLS policies. ' +
        'scanForUnverifiedTenantId() works today and confirms the real, statically-verifiable half ' +
        'of this finding — RLS enforcement itself has not been proven or disproven here.',
    );
  }

  private findFunctionsWithBareTenantId(source: string): string[] {
    const lines = source.split('\n');
    const names: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^export async function (\w+)\(/);
      if (!match) continue;
      const fnName = match[1];

      let signature = '';
      let parenDepth = 0;
      let started = false;
      for (let j = i; j < lines.length; j++) {
        for (const ch of lines[j]) {
          if (ch === '(') {
            parenDepth++;
            started = true;
          }
          if (ch === ')') parenDepth--;
        }
        signature += lines[j] + '\n';
        if (started && parenDepth === 0) break;
      }

      if (/tenantId:\s*string/.test(signature)) {
        names.push(fnName);
      }
    }

    return names;
  }
}
