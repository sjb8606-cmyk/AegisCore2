/**
 * platform/bot-runtime/src/decision-store.ts
 *
 * Persists every Decision a bot records, so a later explainDecision()
 * call — in this process or a fresh one — can answer grounded in what
 * the bot actually found, not just what it remembers in memory.
 *
 * Deliberately NON-RLS, same pattern as signature_tokens in
 * platform/contracts/src/contracts.ts: bot decisions are system-level
 * swarm data (SYSTEM_TENANT_ID / 'system' actor), not per-tenant
 * customer data — there is no real tenant UUID to key RLS off of, so
 * this is queried directly via getPool(), never withTenantQuery().
 *
 * Table: migrations/sql/V266__create_bot_decisions.sql
 */

import { getPool } from '@platform/tenancy';
import { Decision } from './types';

export async function saveDecision(decision: Decision): Promise<void> {
  await getPool().query(
    `INSERT INTO bot_decisions (decision_id, bot_id, status, input, output, rules_hash, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      decision.id,
      decision.botId,
      decision.status,
      JSON.stringify(decision.input),
      JSON.stringify(decision.output),
      decision.rulesHash,
      decision.timestamp,
    ],
  );
}

export async function getDecision(decisionId: string): Promise<Decision | null> {
  const result = await getPool().query(
    `SELECT decision_id, bot_id, status, input, output, rules_hash, created_at
     FROM bot_decisions
     WHERE decision_id = $1`,
    [decisionId],
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    id: row.decision_id,
    botId: row.bot_id,
    status: row.status,
    input: row.input,
    output: row.output,
    rulesHash: row.rules_hash,
    timestamp: new Date(row.created_at).toISOString(),
  };
}

/**
 * Guarded state transition — only ever moves a decision FROM
 * 'pending_approval' TO 'approved'/'rejected', enforced at the SQL
 * level (WHERE status = 'pending_approval'), not just in application
 * code. Returns whether a row was actually updated, so a caller can
 * tell the difference between "recorded" and "nothing to record"
 * (decision doesn't exist, was never gated, or was already decided).
 */
export async function updateDecisionStatus(
  decisionId: string,
  newStatus: 'approved' | 'rejected',
): Promise<boolean> {
  const result = await getPool().query(
    `UPDATE bot_decisions
     SET status = $1
     WHERE decision_id = $2 AND status = 'pending_approval'`,
    [newStatus, decisionId],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Decisions previously given an actual human verdict (approved or
 * rejected) for a specific rulesHash — the raw material for a
 * precedent catalog. Deliberately excludes 'logged'/'pending_approval'
 * rows, since no human judgment has been recorded on those yet.
 */
export async function listDecisionsByRulesHash(rulesHash: string, limit = 20): Promise<Decision[]> {
  const result = await getPool().query(
    `SELECT decision_id, bot_id, status, input, output, rules_hash, created_at
     FROM bot_decisions
     WHERE rules_hash = $1 AND status IN ('approved', 'rejected')
     ORDER BY created_at DESC
     LIMIT $2`,
    [rulesHash, limit],
  );

  return result.rows.map((row: any) => ({
    id: row.decision_id,
    botId: row.bot_id,
    status: row.status,
    input: row.input,
    output: row.output,
    rulesHash: row.rules_hash,
    timestamp: new Date(row.created_at).toISOString(),
  }));
}

/** Most recent decisions for a specific bot — used by explainDecision()-adjacent lookups. */
export async function listDecisions(botId: string, limit = 20): Promise<Decision[]> {
  const result = await getPool().query(
    `SELECT decision_id, bot_id, status, input, output, rules_hash, created_at
     FROM bot_decisions
     WHERE bot_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [botId, limit],
  );

  return result.rows.map((row: any) => ({
    id: row.decision_id,
    botId: row.bot_id,
    status: row.status,
    input: row.input,
    output: row.output,
    rulesHash: row.rules_hash,
    timestamp: new Date(row.created_at).toISOString(),
  }));
}
