/**
 * platform/aegis-swarm/src/repair/agent-spec-repair.ts
 *
 * RS-06 — Agent Spec Repair.
 *
 * Maps directly to R-18's real findings tonight: methods callable
 * without going through enforcePermission(). This bot proposes the
 * exact real mechanical patch — inserting a real
 * `await this.enforcePermission('scope');` line as the first
 * statement of the method body. Real string transformation, verified
 * against a real missing-check case and a real already-has-check
 * case (correctly skipped, not double-patched) before implementation.
 *
 * Deliberately narrow: this does not attempt general code repair via
 * an AST or LLM rewrite — it performs one specific, mechanical,
 * verifiable insertion, the same class of fix R-18 already flags as
 * needing.
 */

import { CrystalBot } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';

export interface PatchResult {
  patched: string | null;
  reason: string | null;
}

export function alreadyHasPermissionCheck(methodSource: string): boolean {
  return /enforcePermission\(/.test(methodSource);
}

export function insertPermissionCheck(methodSource: string, scope: string): PatchResult {
  if (alreadyHasPermissionCheck(methodSource)) {
    return { patched: null, reason: 'already has a real enforcePermission() call — not re-patched' };
  }
  const braceIndex = methodSource.indexOf('{');
  if (braceIndex === -1) {
    return { patched: null, reason: 'no real method body found to patch' };
  }
  const before = methodSource.slice(0, braceIndex + 1);
  const after = methodSource.slice(braceIndex + 1);
  const insertion = `\n    await this.enforcePermission('${scope}');`;
  return { patched: before + insertion + after, reason: null };
}

export interface SpecRepairFinding {
  methodName: string;
  methodSource: string;
  requiredScope: string;
}

export interface SpecRepairResult {
  methodName: string;
  patchResult: PatchResult;
}

export class AgentSpecRepairBot extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async proposePatches(findings: SpecRepairFinding[]): Promise<SpecRepairResult[]> {
    await this.enforcePermission('read:agent-spec-findings');

    const results: SpecRepairResult[] = findings.map((f) => ({
      methodName: f.methodName,
      patchResult: insertPermissionCheck(f.methodSource, f.requiredScope),
    }));

    const genuinelyPatched = results.filter((r) => r.patchResult.patched !== null);

    await this.createDecision(
      { findingCount: findings.length },
      { patchedCount: genuinelyPatched.length },
      'agent-spec-repair-v1',
    );

    if (genuinelyPatched.length > 0) {
      await this.signalSwarm('repair.spec_patches_proposed', {
        botId: this.botId,
        methodNames: genuinelyPatched.map((r) => r.methodName),
      });
    }

    return results;
  }
}
