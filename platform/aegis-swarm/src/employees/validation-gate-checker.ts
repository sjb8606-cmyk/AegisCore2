/**
 * platform/aegis-swarm/src/employees/validation-gate-checker.ts
 *
 * E-37 — Validation Gate Checker.
 *
 * Real completeness gate over the 12 mandatory gates named in the
 * SaaS-generator spec reviewed earlier tonight — same explicit rule
 * as that spec stated: "Generation must fail if any missing." Not a
 * new invention; the real enforcement of a rule that was already
 * written down but never actually checked by code.
 *
 * Distinguishes two genuinely different failure states, verified
 * before implementation: a gate that was never declared at all
 * (missing) versus one that was declared but reported as not
 * satisfied (unsatisfied) — different diagnostic information, both
 * block launch-readiness the same way.
 *
 * This bot checks real declarations supplied to it — it does not
 * itself inspect a live system to determine whether encryption,
 * OTel, SBOM signing, etc. are actually configured. That
 * verification is a separate, real investigation for each gate;
 * this bot enforces the completeness rule once that evidence exists.
 */

import { CrystalBot } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';

export type ValidationGate =
  | 'encryption_at_rest_and_transit'
  | 'observability_traces_and_metrics'
  | 'sbom_and_signing'
  | 'immutable_audit_pipeline'
  | 'rls_tenant_isolation_tests'
  | 'async_queue_dlq'
  | 'jwt_replay_protection'
  | 'ai_safety_eval'
  | 'secrets_policy'
  | 'migrations_with_rollback'
  | 'rate_limiting'
  | 'pagination';

export const REQUIRED_GATES: ValidationGate[] = [
  'encryption_at_rest_and_transit',
  'observability_traces_and_metrics',
  'sbom_and_signing',
  'immutable_audit_pipeline',
  'rls_tenant_isolation_tests',
  'async_queue_dlq',
  'jwt_replay_protection',
  'ai_safety_eval',
  'secrets_policy',
  'migrations_with_rollback',
  'rate_limiting',
  'pagination',
];

export interface GateDeclaration {
  satisfied: boolean;
  evidence: string;
}

export type GateDeclarations = Partial<Record<ValidationGate, GateDeclaration>>;

export interface GateCheckResult {
  launchReady: boolean;
  missing: ValidationGate[];
  unsatisfied: ValidationGate[];
}

export function checkGates(declarations: GateDeclarations): GateCheckResult {
  const missing: ValidationGate[] = [];
  const unsatisfied: ValidationGate[] = [];

  for (const gate of REQUIRED_GATES) {
    const decl = declarations[gate];
    if (!decl) missing.push(gate);
    else if (!decl.satisfied) unsatisfied.push(gate);
  }

  return { launchReady: missing.length === 0 && unsatisfied.length === 0, missing, unsatisfied };
}

export class ValidationGateCheckerBot extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async checkLaunchReadiness(declarations: GateDeclarations): Promise<GateCheckResult> {
    await this.enforcePermission('read:validation-gates');

    const result = checkGates(declarations);

    await this.createDecision(
      { declaredGateCount: Object.keys(declarations).length },
      { launchReady: result.launchReady, missingCount: result.missing.length, unsatisfiedCount: result.unsatisfied.length },
      'validation-gate-checker-v1',
    );

    if (!result.launchReady) {
      await this.signalSwarm('employee.launch_gates_incomplete', {
        botId: this.botId,
        missing: result.missing,
        unsatisfied: result.unsatisfied,
      });
    }

    return result;
  }
}
