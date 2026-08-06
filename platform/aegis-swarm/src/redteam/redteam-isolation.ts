/**
 * platform/aegis-swarm/src/redteam/redteam-isolation.ts
 *
 * Minimal, REAL isolation for red team bots — not a claim to the
 * AppSpec's full Red Team VPC / Veridact Cage model (separate network,
 * redteam:: key prefix, @SandboxConstraint() decorator). None of that
 * exists in this repo. What this module actually provides is a real,
 * enforced *software* boundary within the same Node process:
 *
 * 1. A completely separate swarm signal bus. Not the same object as
 *    the real production swarmSignalBus — publishing here is
 *    structurally incapable of reaching it, proven directly by a test
 *    that checks nothing crosses over (not just documented/assumed).
 *
 * 2. createDecision() never persists to the shared production
 *    bot_decisions table. Decisions are tracked in an in-memory,
 *    per-instance list instead — proven by the fact that this module
 *    needs no decision-store mock in its tests at all, because the
 *    real store is never called.
 *
 * 3. A cloneTarget() helper using structuredClone() for genuine deep
 *    copies before an attack runs. This one is provided tooling and
 *    convention, not a type-system-enforced guarantee like 1 and 2 —
 *    a red team bot author still has to actually call it.
 *
 * Real network/VPC isolation, the redteam:: key prefix, and the
 * Veridact Cage queue remain genuine, larger follow-up work.
 */

import { randomUUID } from 'crypto';
import { CrystalBot, SwarmSignalBus, SwarmSignal, Decision, DecisionStatus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';

export const redTeamSignalBus = new SwarmSignalBus();

export interface RedTeamDecisionRecord {
  id: string;
  botId: string;
  input: unknown;
  output: unknown;
  rulesHash: string;
  timestamp: string;
}

export abstract class RedTeamBot extends CrystalBot {
  private redTeamDecisions: RedTeamDecisionRecord[] = [];

  constructor(spec: BotSpecification) {
    super(spec);
  }

  protected async signalSwarm(type: string, payload: unknown): Promise<void> {
    const signal: SwarmSignal = {
      type,
      fromBotId: this.botId,
      payload,
      timestamp: new Date().toISOString(),
    };
    this.logger.info({ type, payload }, 'Red team bot signaling isolated bus (not production)');
    redTeamSignalBus.publish(signal);
  }

  protected async createDecision(input: unknown, output: unknown, rulesHash: string): Promise<Decision> {
    const record: RedTeamDecisionRecord = {
      id: randomUUID(),
      botId: this.botId,
      input,
      output,
      rulesHash,
      timestamp: new Date().toISOString(),
    };
    this.redTeamDecisions.push(record);

    const status: DecisionStatus = 'logged';
    return { ...record, status };
  }

  getRedTeamDecisions(): RedTeamDecisionRecord[] {
    return [...this.redTeamDecisions];
  }

  protected cloneTarget<T>(target: T): T {
    return structuredClone(target);
  }
}
