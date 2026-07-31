/**
 * Veridact v1.0 — Replay Engine
 *
 * computeDecision() is now async and requires tenantId (policyBundleStore
 * DB conversion) — updated here to await it and pass receipt.tenant_id.
 */

import { logger } from '../db/logger';
import { getReceiptById, recomputeHash, computeDecision } from './receiptEngine';
import { buildDiff, writeChangeEntry } from './changeLog';
import { triggerAlert } from './alertEngine';
import { withTenant } from '../db/client';
import { translate } from './translator';
import type { Actor, Diff, ReplayResponse } from '../types';

interface ReplayParams {
  tenantId: string;
  receiptId: string;
  actor: Actor;
}

export async function replayReceipt(params: ReplayParams): Promise<ReplayResponse> {
  const { tenantId, receiptId, actor } = params;

  const receipt = await getReceiptById(tenantId, receiptId);

  if (!receipt) {
    throw Object.assign(new Error(`Receipt not found: ${receiptId}`), { statusCode: 404 });
  }

  if (!receipt.replayable) {
    throw Object.assign(new Error(`Receipt ${receiptId} is not replayable`), { statusCode: 422 });
  }

  const recomputedHash = recomputeHash(receipt);
  const originalHash = receipt.hash;
  const match = recomputedHash === originalHash;

  const { output: recomputedOutput } = await computeDecision(
    tenantId,
    receipt.input,
    receipt.rules_version,
    receipt.rules_hash
  );

  const delta: Diff = buildDiff(
    receipt.output as Record<string, unknown>,
    recomputedOutput
  );

  const eventType = match ? 'replay_match' : 'replay_mismatch';
  const humanMessage = translate(eventType);

  logger.info(
    {
      receipt_id: receiptId,
      tenant_id: tenantId,
      original_hash: originalHash,
      recomputed_hash: recomputedHash,
      match,
      delta_fields: delta.map((d) => d.field),
      event_type: eventType,
    },
    `replay.${match ? 'match' : 'mismatch'}`
  );

  await withTenant(tenantId, async (client) => {
    await triggerAlert({
      tenantId,
      eventType,
      actor,
      message: match
        ? `Replay matched for receipt ${receiptId}`
        : `Replay MISMATCH for receipt ${receiptId}. original=${originalHash} recomputed=${recomputedHash}`,
      linkedReceipt: receiptId,
      client,
    });

    if (!match) {
      await writeChangeEntry({
        tenantId,
        eventType: 'system_update',
        actor,
        actionType: 'replay_mismatch',
        previousStateHash: originalHash,
        newStateHash: recomputedHash,
        diff: delta,
        linkedReceipt: receiptId,
        client,
      });
    }
  });

  return {
    original_hash: originalHash,
    recomputed_hash: recomputedHash,
    match,
    delta,
    event_type: eventType,
    human_message: humanMessage,
  };
}
