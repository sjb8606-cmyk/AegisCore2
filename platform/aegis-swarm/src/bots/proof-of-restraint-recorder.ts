/**
 * platform/aegis-swarm/src/bots/proof-of-restraint-recorder.ts
 *
 * D-22 — Proof-of-Restraint Recorder.
 *
 * "Records every declined action immutably" — this closes a real gap:
 * every single "blocks X without Y permission" test across all the
 * bots built tonight exercises enforcePermissionBoundary(), which
 * throws and audits (bot.action_blocked) but has never persisted to a
 * real, queryable, immutable ledger. This bot is that missing piece.
 *
 * recordRefusal() is insert-only — restraint-store.ts provides no
 * update or delete function at all. Once a refusal is recorded, it
 * cannot be altered or removed through this bot.
 *
 * Every recorded refusal signals the swarm unconditionally — a
 * declined action is always worth knowing about, matching the
 * AppSpec's intent that this feeds a public transparency concept
 * (GET /api/safety/restraint-ledger), not just an internal log.
 *
 * receipt_id is a nullable placeholder in the underlying table —
 * @features/veridact has not been built in this repo, so there is no
 * real cryptographic receipt to attach yet. Nothing here fabricates one.
 */

import { CrystalBot } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { recordRefusal, listRefusals, RestraintRecord } from '../lib/restraint-store';

export interface RefusalRecordResult extends RestraintRecord {
  decisionId: string;
}

export class ProofOfRestraintRecorderBot extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async recordRefusal(
    tenantId: string,
    refusedBotId: string,
    actionBlocked: string,
    refusalReason: string,
    inputContext: Record<string, unknown> = {},
  ): Promise<RefusalRecordResult> {
    await this.enforcePermission('write:restraint-ledger');

    const record = await recordRefusal(tenantId, refusedBotId, actionBlocked, refusalReason, inputContext);

    const decision = await this.createDecision(
      { tenantId, refusedBotId, actionBlocked, refusalReason },
      { restraintRecordId: record.id },
      'proof-of-restraint-record-v1',
    );

    await this.signalSwarm('proof_of_restraint.refusal_recorded', {
      botId: this.botId,
      refusedBotId,
      tenantId,
      actionBlocked,
    });

    return { ...record, decisionId: decision.id };
  }

  async listRefusals(tenantId: string, limit?: number): Promise<RestraintRecord[]> {
    await this.enforcePermission('read:restraint-ledger');
    return listRefusals(tenantId, limit);
  }
}
