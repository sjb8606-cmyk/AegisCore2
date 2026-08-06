/**
 * platform/aegis-swarm/src/redteam/permission-escalator.ts
 *
 * R-14 — Permission Escalator.
 *
 * "D-11 scope creep, TOCTOU races." Calls the REAL, actual
 * enforcePermissionBoundary() function directly — not a copy, not a
 * reimplementation. This is possible because that function has no
 * side effects beyond safe, write-only audit logging (no
 * createDecision/signalSwarm), unlike every other bot's own methods,
 * so there's no production-contamination risk in calling it directly.
 *
 * The real, verified finding: nothing in this codebase freezes or
 * otherwise protects BotSpecification.permissionScope at runtime.
 * TypeScript's `protected` modifier on CrystalBot's `spec` field is
 * compile-time only — it provides zero runtime protection. Any code
 * holding a reference to a bot's spec object (or bypassing the type
 * system via `as any`, which requires no special privilege in plain
 * JS) can mutate permissionScope in place and grant new permissions
 * instantly, entirely bypassing the "declared once at construction,
 * immutable, spec-driven" trust model the whole swarm's permission
 * boundary rests on. Verified: a forbidden action, denied before
 * mutation, is allowed immediately after — same bot instance, no
 * reconstruction, no legitimate API used.
 *
 * Operates on a deep clone of any spec passed in — never mutates the
 * caller's real BotSpecification object.
 */

import { RedTeamBot } from './redteam-isolation';
import { BotSpecification } from '@platform/bot-registry';
import { enforcePermissionBoundary } from '@platform/bot-runtime';

export interface ScopeMutationResult {
  technique: 'live_scope_mutation';
  action: string;
  injectedScope: string;
  deniedBeforeMutation: boolean;
  allowedAfterMutation: boolean;
  attackSucceeded: boolean;
}

export class PermissionEscalatorBot extends RedTeamBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async attemptLiveScopeMutation(
    targetSpec: BotSpecification,
    forbiddenAction: string,
    injectedScope: string,
  ): Promise<ScopeMutationResult> {
    await this.enforcePermission('redteam:attack-permission-boundary');

    const clonedSpec = this.cloneTarget(targetSpec);

    const deniedBeforeMutation = await this.isDenied(clonedSpec, forbiddenAction);

    clonedSpec.permissionScope.push(injectedScope);

    const allowedAfterMutation = !(await this.isDenied(clonedSpec, forbiddenAction));

    const attemptResult: ScopeMutationResult = {
      technique: 'live_scope_mutation',
      action: forbiddenAction,
      injectedScope,
      deniedBeforeMutation,
      allowedAfterMutation,
      attackSucceeded: deniedBeforeMutation && allowedAfterMutation,
    };

    await this.createDecision(
      { forbiddenAction, injectedScope },
      attemptResult,
      'redteam-permission-escalator-v1',
    );
    await this.signalSwarm('redteam.permission_escalation_attempt', { botId: this.botId, ...attemptResult });

    return attemptResult;
  }

  private async isDenied(spec: BotSpecification, action: string): Promise<boolean> {
    try {
      await enforcePermissionBoundary(spec, action);
      return false;
    } catch {
      return true;
    }
  }
}
