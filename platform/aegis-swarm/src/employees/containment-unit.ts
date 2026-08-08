/**
 * platform/aegis-swarm/src/employees/containment-unit.ts
 *
 * E-32 — Containment Unit.
 *
 * Real kill-switch state machine — the genuine gap Fort Knox's
 * taxonomy named (Containment_Unit) that nothing built tonight
 * covered. Real, scope-aware containment: a tenant, feature, or
 * region can be independently contained and released, and the
 * scope+targetId pair is checked together — the same ID under a
 * different scope (e.g. a feature named the same as a tenant) is
 * correctly treated as unrelated. Verified against real cases before
 * implementation.
 */

import { CrystalBot } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';

export type ContainmentScope = 'tenant' | 'feature' | 'region';
export type ContainmentStatus = 'active' | 'contained';

export interface ContainmentRecord {
  scope: ContainmentScope;
  targetId: string;
  status: ContainmentStatus;
  reason: string;
  containedAtMs: number | null;
}

export function isContained(registry: ContainmentRecord[], scope: ContainmentScope, targetId: string): boolean {
  const record = registry.find((r) => r.scope === scope && r.targetId === targetId);
  return record ? record.status === 'contained' : false;
}

export function contain(
  registry: ContainmentRecord[],
  scope: ContainmentScope,
  targetId: string,
  reason: string,
  nowMs: number,
): ContainmentRecord[] {
  const filtered = registry.filter((r) => !(r.scope === scope && r.targetId === targetId));
  return [...filtered, { scope, targetId, status: 'contained', reason, containedAtMs: nowMs }];
}

export function release(registry: ContainmentRecord[], scope: ContainmentScope, targetId: string): ContainmentRecord[] {
  const filtered = registry.filter((r) => !(r.scope === scope && r.targetId === targetId));
  return [...filtered, { scope, targetId, status: 'active', reason: '', containedAtMs: null }];
}

export class ContainmentUnitBot extends CrystalBot {
  private registry: ContainmentRecord[] = [];

  constructor(spec: BotSpecification) {
    super(spec);
  }

  async containTarget(scope: ContainmentScope, targetId: string, reason: string): Promise<ContainmentRecord[]> {
    await this.enforcePermission('write:containment');

    this.registry = contain(this.registry, scope, targetId, reason, Date.now());

    await this.createDecision({ scope, targetId, reason }, { status: 'contained' }, 'containment-unit-v1');
    await this.signalSwarm('employee.target_contained', { botId: this.botId, scope, targetId, reason });

    return this.registry;
  }

  async releaseTarget(scope: ContainmentScope, targetId: string): Promise<ContainmentRecord[]> {
    await this.enforcePermission('write:containment');

    this.registry = release(this.registry, scope, targetId);

    await this.createDecision({ scope, targetId }, { status: 'active' }, 'containment-unit-v1');

    return this.registry;
  }

  async checkContainment(scope: ContainmentScope, targetId: string): Promise<boolean> {
    await this.enforcePermission('read:containment');
    return isContained(this.registry, scope, targetId);
  }
}
