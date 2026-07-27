/**
 * Veridact v1.0 — Receipt Engine
 *
 * Responsibilities:
 *  1. Accept a ContextEnvelope + Actor, produce a deterministic Receipt.
 *  2. Enforce idempotency — same idempotency_key returns the existing receipt.
 *  3. Chain hash to previous receipt via @platform/audit Merkle helpers.
 *  4. Persist to receipts table via RLS-aware DB client.
 *  5. Trigger change log entry on every new write.
 *
 * Hash construction (deterministic):
 *   SHA-256( receipt_id + rules_hash + JSON.stringify(sortedInput) + previous_hash )
 *
 * SWAP: replace merkleChain() stub with @platform/audit.appendToChain() before production
 * computeDecision() now runs the real Policy Rule Evaluator (Core 1) —
 * see src/engines/policyEngine.ts and src/engines/policyBundleStore.ts
 */

import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { withTenant } from '../db/client';
import { logger } from '../db/logger';
import type {
  Actor,
  ContextEnvelope,
  Receipt,
  VerifyResponse,
} from '../types';
import { ReceiptSchema } from '../schemas';
import { translate } from './translator';
import { writeChangeEntry } from './changeLog';
import { triggerAlert } from './alertEngine';
import { evaluatePolicy } from './policyEngine';
import { getPolicyBundle } from './policyBundleStore';

// ─── Hash Utilities ───────────────────────────────────────────────────────────

function computeReceiptHash(
  receiptId: string,
  rulesHash: string,
  input: Record<string, unknown>,
  previousHash: string
): string {
  const sorted = JSON.stringify(
    Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)))
  );
  return crypto
    .createHash('sha256')
    .update(`${receiptId}:${rulesHash}:${sorted}:${previousHash}`)
    .digest('hex');
}

async function getPreviousHash(tenantId: string, client: import('pg').PoolClient): Promise<string> {
  const res = await client.query<{ hash: string }>(
    `SELECT hash FROM receipts
     WHERE tenant_id = $1 AND deleted_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [tenantId]
  );
  if (res.rows.length === 0) {
    return '0'.repeat(64);
  }
  return res.rows[0].hash;
}

/**
 * Compute the decision output from the input + rules.
 * Real implementation — runs evaluatePolicy() against the PolicyBundle
 * registered for the given rules_version, after verifying rules_hash matches.
 */
function computeDecision(
  input: Record<string, unknown>,
  rulesVersion: string,
  rulesHash: string
): { decision: string; output: Record<string, unknown> } {
  const bundle = getPolicyBundle(rulesVersion, rulesHash);
  const result = evaluatePolicy(input, bundle);

  return {
    decision: result.decision,
    output: {
      decision: result.decision,
      requires_hitl: result.requires_hitl,
      matched_rule_id: result.matched_rule_id,
      reason: result.reason,
      evaluated_rules: result.evaluated_rules,
      evaluated_at: new Date().toISOString(),
    },
  };
}

// ─── Idempotency Check ────────────────────────────────────────────────────────

async function findExistingReceipt(
  tenantId: string,
  idempotencyKey: string,
  client: import('pg').PoolClient
): Promise<Receipt | null> {
  const res = await client.query<Record<string, unknown>>(
    `SELECT * FROM receipts
     WHERE tenant_id = $1
       AND idempotency_key = $2
       AND deleted_at IS NULL
     LIMIT 1`,
    [tenantId, idempotencyKey]
  );

  if (res.rows.length === 0) return null;

  return rowToReceipt(res.rows[0]);
}

// ─── Row Mapper ───────────────────────────────────────────────────────────────

function rowToReceipt(row: Record<string, unknown>): Receipt {
  return {
    receipt_id: row.receipt_id as string,
    tenant_id: row.tenant_id as string,
    idempotency_key: row.idempotency_key as string | undefined,
    event_type: 'new_receipt',
    input: row.input as Record<string, unknown>,
    output: row.output as Record<string, unknown>,
    rules_version: row.rules_version as string,
    rules_hash: row.rules_hash as string,
    hash: row.hash as string,
    previous_hash: row.previous_hash as string,
    timestamp: (row.created_at as Date).toISOString(),
    replayable: true,
    actor: row.actor as Actor,
    context: row.context as Receipt['context'],
  };
}

// ─── Core: Create Receipt ─────────────────────────────────────────────────────

export interface CreateReceiptParams {
  tenantId: string;
  envelope: ContextEnvelope;
  actor: Actor;
}

export async function createReceipt(
  params: CreateReceiptParams
): Promise<{ receipt: Receipt; isNew: boolean }> {
  const { tenantId, envelope, actor } = params;
  const { idempotency_key, input, rules_version, rules_hash, context } = envelope;

  return withTenant(tenantId, async (client) => {
    if (idempotency_key) {
      const existing = await findExistingReceipt(tenantId, idempotency_key, client);
      if (existing) {
        logger.info(
          { receipt_id: existing.receipt_id, idempotency_key, tenant_id: tenantId },
          'receipt.idempotent_hit'
        );
        return { receipt: existing, isNew: false };
      }
    }

    const previousHash = await getPreviousHash(tenantId, client);
    const receiptId = uuidv4();
    const hash = computeReceiptHash(receiptId, rules_hash, input, previousHash);

    const { decision, output } = computeDecision(input, rules_version, rules_hash);

    const now = new Date().toISOString();
    const receipt: Receipt = {
      receipt_id: receiptId,
      tenant_id: tenantId,
      idempotency_key: idempotency_key,
      event_type: 'new_receipt',
      input,
      output,
      rules_version,
      rules_hash,
      hash,
      previous_hash: previousHash,
      timestamp: now,
      replayable: true,
      actor,
      context,
    };

    const parsed = ReceiptSchema.safeParse(receipt);
    if (!parsed.success) {
      logger.error({ errors: parsed.error.errors }, 'receipt.schema_validation_failed');
      throw new Error(`Receipt schema validation failed: ${parsed.error.message}`);
    }

    await client.query(
      `INSERT INTO receipts (
        receipt_id, tenant_id, idempotency_key, event_type,
        input, output, rules_version, rules_hash,
        hash, previous_hash, replayable, actor, context, created_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW()
      )`,
      [
        receipt.receipt_id,
        tenantId,
        idempotency_key ?? null,
        'new_receipt',
        JSON.stringify(input),
        JSON.stringify(output),
        rules_version,
        rules_hash,
        hash,
        previousHash,
        true,
        JSON.stringify(actor),
        JSON.stringify(context),
      ]
    );

    logger.info(
      { receipt_id: receiptId, tenant_id: tenantId, rules_version, decision },
      'receipt.created'
    );

    await writeChangeEntry({
      tenantId,
      eventType: 'new_receipt' as never,
      actor,
      actionType: 'verify',
      previousStateHash: previousHash,
      newStateHash: hash,
      diff: [],
      linkedReceipt: receiptId,
      client,
    });

    await triggerAlert({
      tenantId,
      eventType: 'new_receipt',
      actor,
      linkedReceipt: receiptId,
      message: `New receipt created: ${receiptId}`,
      client,
    });

    return { receipt, isNew: true };
  });
}

export async function getReceiptById(
  tenantId: string,
  receiptId: string
): Promise<Receipt | null> {
  return withTenant(tenantId, async (client) => {
    const res = await client.query<Record<string, unknown>>(
      `SELECT * FROM receipts
       WHERE receipt_id = $1
         AND tenant_id = $2
         AND deleted_at IS NULL`,
      [receiptId, tenantId]
    );
    if (res.rows.length === 0) return null;
    return rowToReceipt(res.rows[0]);
  });
}

export async function listReceipts(
  tenantId: string,
  page: number,
  limit: number
): Promise<{ rows: Receipt[]; total: number }> {
  const offset = (page - 1) * limit;

  return withTenant(tenantId, async (client) => {
    const [dataRes, countRes] = await Promise.all([
      client.query<Record<string, unknown>>(
        `SELECT * FROM receipts
         WHERE tenant_id = $1 AND deleted_at IS NULL
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [tenantId, limit, offset]
      ),
      client.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM receipts
         WHERE tenant_id = $1 AND deleted_at IS NULL`,
        [tenantId]
      ),
    ]);

    return {
      rows: dataRes.rows.map(rowToReceipt),
      total: parseInt(countRes.rows[0].count, 10),
    };
  });
}

export function recomputeHash(receipt: Receipt): string {
  return computeReceiptHash(
    receipt.receipt_id,
    receipt.rules_hash,
    receipt.input,
    receipt.previous_hash
  );
}

export { computeDecision };
