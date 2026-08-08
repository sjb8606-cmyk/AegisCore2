/**
 * platform/aegis-swarm/src/repair/dependency-repair.ts
 *
 * RS-03 — Dependency Repair Specialist.
 *
 * The one genuinely buildable repair bot identified earlier tonight:
 * D-06 already wraps real `npm audit --json` output, so a repair bot
 * consuming that same real, documented JSON shape is real work, not
 * speculation. planRepairs() classifies real vulnerabilities into
 * three real buckets using npm's own actual fixAvailable field:
 *
 * - auto-fixable: a real fix exists and is not a breaking change
 * - needs manual review: a real fix exists but is a semver-major
 *   bump — a breaking change, real HITL territory, never auto-applied
 * - no fix available: npm itself reports no real fix exists yet
 *
 * Verified against a real, representative npm audit shape (a normal
 * fix, a breaking-change fix, and a no-fix case) before
 * implementation. This bot proposes a repair plan — it does not
 * itself execute `npm audit fix`, since running real npm commands
 * against a real lockfile is a genuine write action that belongs
 * behind the person's own review, not an unattended bot.
 */

import { CrystalBot } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';

export interface NpmFixAvailable {
  name: string;
  version: string;
  isSemVerMajor: boolean;
}

export interface NpmVulnerability {
  severity: string;
  fixAvailable: NpmFixAvailable | boolean;
}

export type NpmAuditVulnerabilities = Record<string, NpmVulnerability>;

export interface ManualReviewItem {
  name: string;
  toVersion: string;
}

export interface RepairPlan {
  autoFixable: string[];
  needsManualReview: ManualReviewItem[];
  noFixAvailable: string[];
}

export function planRepairs(auditVulnerabilities: NpmAuditVulnerabilities): RepairPlan {
  const autoFixable: string[] = [];
  const needsManualReview: ManualReviewItem[] = [];
  const noFixAvailable: string[] = [];

  for (const [name, vuln] of Object.entries(auditVulnerabilities)) {
    if (!vuln.fixAvailable) {
      noFixAvailable.push(name);
    } else if (typeof vuln.fixAvailable === 'object' && vuln.fixAvailable.isSemVerMajor) {
      needsManualReview.push({ name, toVersion: vuln.fixAvailable.version });
    } else if (typeof vuln.fixAvailable === 'object') {
      autoFixable.push(name);
    } else {
      autoFixable.push(name);
    }
  }

  return { autoFixable, needsManualReview, noFixAvailable };
}

export class DependencyRepairBot extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async proposeRepairPlan(auditVulnerabilities: NpmAuditVulnerabilities): Promise<RepairPlan> {
    await this.enforcePermission('read:dependency-audit');

    const plan = planRepairs(auditVulnerabilities);

    await this.createDecision(
      { vulnerabilityCount: Object.keys(auditVulnerabilities).length },
      { autoFixableCount: plan.autoFixable.length, needsReviewCount: plan.needsManualReview.length },
      'dependency-repair-v1',
    );

    if (plan.needsManualReview.length > 0) {
      await this.signalSwarm('repair.breaking_change_review_needed', {
        botId: this.botId,
        items: plan.needsManualReview,
      });
    }

    return plan;
  }
}
