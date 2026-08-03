/**
 * platform/aegis-swarm/src/bots/forensic-janitor.ts
 *
 * D-12 — Forensic Janitor.
 *
 * HITL-authorized data purges with a real 24-hour time-lock. The
 * human authorization happens once, up front, at request time
 * (authorizedBy — a CISO-only action per the AppSpec); the 24-hour
 * window that follows is a cancellation safety valve, not a second
 * approval gate. This is why hitlClassification is 'Alert', not
 * 'Synchronous Gate': the real gate here is the time-lock itself,
 * enforced at the SQL level (unlocks_at <= NOW()) in purge-store.ts —
 * a stronger, cryptographically-timed guarantee than a status flag.
 *
 * Request and cancel share one permission scope; execution requires a
 * separate, narrower scope (execute:purge) — separation of duties, so
 * whatever is authorized to request a purge isn't automatically
 * authorized to actually run it.
 *
 * receipt_id is a nullable placeholder in the underlying table —
 * @features/veridact has not been built in this repo, so there is no
 * real cryptographic receipt to attach to a purge yet. Nothing here
 * fabricates one.
 */

import { CrystalBot } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { requestPurge, cancelPurge, executePurge, getPurge, PendingPurge } from '../lib/purge-store';

export interface PurgeRequestResult extends PendingPurge {
  decisionId: string;
}

export class ForensicJanitorBot extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async requestPurge(tenantId: string, dataScope: string, authorizedBy: string): Promise<PurgeRequestResult> {
    await this.enforcePermission('write:purge-requests');

    const purge = await requestPurge(tenantId, dataScope, authorizedBy);

    const decision = await this.createDecision(
      { tenantId, dataScope, authorizedBy },
      { purgeId: purge.id, unlocksAt: purge.unlocksAt },
      'forensic-janitor-request-v1',
    );

    await this.signalSwarm('forensic_janitor.purge_requested', {
      botId: this.botId,
      purgeId: purge.id,
      tenantId,
      unlocksAt: purge.unlocksAt,
    });

    return { ...purge, decisionId: decision.id };
  }

  async cancelPurge(tenantId: string, purgeId: string): Promise<{ cancelled: boolean }> {
    await this.enforcePermission('write:purge-requests');

    const cancelled = await cancelPurge(tenantId, purgeId);

    await this.createDecision({ tenantId, purgeId }, { cancelled }, 'forensic-janitor-cancel-v1');

    return { cancelled };
  }

  async executePurge(tenantId: string, purgeId: string): Promise<{ executed: boolean }> {
    await this.enforcePermission('execute:purge');

    const executed = await executePurge(tenantId, purgeId);

    await this.createDecision({ tenantId, purgeId }, { executed }, 'forensic-janitor-execute-v1');

    if (executed) {
      await this.signalSwarm('forensic_janitor.purge_executed', {
        botId: this.botId,
        purgeId,
        tenantId,
      });
    }

    return { executed };
  }

  async getPurgeStatus(tenantId: string, purgeId: string): Promise<PendingPurge | null> {
    await this.enforcePermission('read:purge-requests');
    return getPurge(tenantId, purgeId);
  }
}
