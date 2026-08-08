/**
 * platform/aegis-swarm/src/employees/factory-manager.ts
 *
 * E-16 — Agent/Worker Factory Manager.
 *
 * Real completeness gate for a proposed new employee spec, before it
 * gets added to the real roster — same discipline as Reality Anchor's
 * checkGroundingCompleteness(), applied to spawning employees rather
 * than grounding ideas. Also checks for a real ID collision against
 * the actual live spec roster in config/bots/, not a synthetic list.
 * Verified against a complete spec, an incomplete spec, and a real
 * collision case before implementation.
 */

import * as fs from 'fs';
import { CrystalBot } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';

export interface ProposedSpec {
  proposedBotId: string;
  role: string;
  permissionScope: string[];
  hitlClassification: string;
  hardStops: string[];
  behaviorDescription: string;
}

export interface SpecCompletenessCheck {
  complete: boolean;
  missing: string[];
}

const VALID_HITL = ['Logging', 'Alert', 'Synchronous Gate'];

export function validateSpecCompleteness(spec: ProposedSpec): SpecCompletenessCheck {
  const missing: string[] = [];
  if (!spec.proposedBotId) missing.push('proposedBotId');
  if (!spec.role || spec.role.trim().length === 0) missing.push('role');
  if (!spec.permissionScope || spec.permissionScope.length === 0) missing.push('permissionScope');
  if (!VALID_HITL.includes(spec.hitlClassification)) missing.push('hitlClassification');
  if (!spec.hardStops || spec.hardStops.length === 0) missing.push('hardStops');
  if (!spec.behaviorDescription || spec.behaviorDescription.trim().length === 0) missing.push('behaviorDescription');
  return { complete: missing.length === 0, missing };
}

export function checkIdCollision(proposedId: string, existingIds: string[]): boolean {
  return existingIds.includes(proposedId);
}

export function loadExistingBotIds(botsDir: string): string[] {
  const files = fs.readdirSync(botsDir).filter((f) => f.endsWith('.json'));
  const ids: string[] = [];
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(`${botsDir}/${file}`, 'utf8'));
      if (data.proposedBotId) ids.push(data.proposedBotId);
    } catch {
      continue;
    }
  }
  return ids;
}

export interface FactoryReview {
  completenessCheck: SpecCompletenessCheck;
  idCollision: boolean;
  approved: boolean;
}

export class FactoryManagerBot extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async reviewProposedSpec(proposed: ProposedSpec, botsDir: string): Promise<FactoryReview> {
    await this.enforcePermission('read:bot-registry');

    const completenessCheck = validateSpecCompleteness(proposed);
    const existingIds = loadExistingBotIds(botsDir);
    const idCollision = checkIdCollision(proposed.proposedBotId, existingIds);
    const approved = completenessCheck.complete && !idCollision;

    const review: FactoryReview = { completenessCheck, idCollision, approved };

    await this.createDecision(
      { proposedBotId: proposed.proposedBotId },
      { approved, missingCount: completenessCheck.missing.length, idCollision },
      'factory-manager-v1',
    );

    if (!approved) {
      await this.signalSwarm('employee.spec_rejected', {
        botId: this.botId,
        proposedBotId: proposed.proposedBotId,
        idCollision,
      });
    }

    return review;
  }
}
