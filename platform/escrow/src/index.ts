/**
 * platform/escrow/src/index.ts
 *
 * Generic escrow with a tamper-evident event history — reusable by any
 * marketplace-shaped vertical (originally scoped for the AgoraX spec,
 * but equally applicable to Tidelock buyer/seller transactions or any
 * future marketplace core; deliberately has no AgoraX-specific fields).
 *
 * This is the first real adopter of @platform/hash-chain. Every escrow
 * state transition (open, fund, release, refund, dispute, resolve) is
 * appended to escrow_events as a chained event.
 *
 * Money movement itself (holding funds, actually paying out) is NOT
 * done here — this core only tracks escrow *state* and its evidentiary
 * trail. A real deployment wires fundEscrow/releaseEscrow/refundEscrow
 * to whatever payment rail actually moves money at the app layer.
 */

import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { enforceQuota } from '@platform/quota-guard';
import { withTenantQuery, withTenant } from '@platform/tenancy';
import { computeChainHash, verifyChain, GENESIS_HASH, ChainEvent } from '@platform/hash-chain';

export { AppError, ErrorCode };

const ConfigSchema = z.object({
  enabled: z.boolean(),
  limits: z.object({
    openEscrowsPerMonth: z.number(),
  }),
});

export type EscrowStatus = 'open' | 'funded' | 'released' | 'refunded' | 'disputed';

const VALID_TRANSITIONS: Record<EscrowStatus, EscrowStatus[]> = {
  open: ['funded', 'disputed'],
  funded: ['released', 'refunded', 'disputed'],
  disputed: ['released', 'refunded'],
  released: [],
  refunded: [],
};

async function appendEvent(
  client: any,
  tenantId: string,
  escrowId: string,
  eventType: string,
  payload: Record<string, unknown>,
) {
  const prevRes = await client.query(
    'SELECT hash FROM escrow_events WHERE escrow_id = $1 ORDER BY seq DESC LIMIT 1',
    [escrowId],
  );
  const previousHash = prevRes.rows[0]?.hash ?? GENESIS_HASH;
  const hash = computeChainHash(escrowId, eventType, payload, previousHash);
  const { randomUUID } = await import('crypto');
  await client.query(
    `INSERT INTO escrow_events (id, tenant_id, escrow_id, event_type, payload_json, previous_hash, hash, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
    [randomUUID(), tenantId, escrowId, eventType, JSON.stringify(payload), previousHash, hash],
  );
  return hash;
}

async function transition(
  tenantId: string,
  actorId: string,
  escrowId: string,
  to: EscrowStatus,
  eventType: string,
  extraPayload: Record<string, unknown>,
  auditAction: string,
) {
  return runCrudOperation({
    configName: 'escrow',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      return withTenant(tenantId, async (client) => {
        const res = await client.query('SELECT * FROM escrows WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [escrowId, tenantId]);
        const escrow = res.rows[0];
        if (!escrow) throw new AppError('Escrow not found', ErrorCode.NOT_FOUND);

        const allowed = VALID_TRANSITIONS[escrow.status as EscrowStatus] ?? [];
        if (!allowed.includes(to)) {
          throw new AppError(`Cannot move escrow from '${escrow.status}' to '${to}'`, ErrorCode.CONFLICT);
        }

        await client.query('UPDATE escrows SET status = $1, updated_at = NOW() WHERE id = $2', [to, escrowId]);
        await appendEvent(client, tenantId, escrowId, eventType, { actorId, from: escrow.status, to, ...extraPayload });

        const updated = await client.query('SELECT * FROM escrows WHERE id = $1', [escrowId]);
        return updated.rows[0];
      });
    },
    auditAction,
    auditResource: 'escrow',
    auditResourceId: escrowId,
  });
}

export async function openEscrow(
  tenantId: string,
  actorId: string,
  data: { referenceId: string; buyerId: string; sellerId: string; amountCents: number; currency: string },
) {
  return runCrudOperation({
    configName: 'escrow',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    checkQuota: async (config: any) => {
      const countRes = await withTenantQuery(
        "SELECT COUNT(*) as count FROM escrows WHERE tenant_id = $1 AND created_at > NOW() - INTERVAL '30 days'",
        [tenantId],
        tenantId,
      );
      enforceQuota(countRes[0]?.count, config.limits.openEscrowsPerMonth, 'Monthly escrow creation limit reached');
    },
    action: async () => {
      const { randomUUID } = await import('crypto');
      const escrowId = randomUUID();
      return withTenant(tenantId, async (client) => {
        const res = await client.query(
          `INSERT INTO escrows (id, tenant_id, reference_id, buyer_id, seller_id, amount_cents, currency, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'open', NOW(), NOW())
           RETURNING *`,
          [escrowId, tenantId, data.referenceId, data.buyerId, data.sellerId, data.amountCents, data.currency],
        );
        await appendEvent(client, tenantId, escrowId, 'opened', {
          buyerId: data.buyerId,
          sellerId: data.sellerId,
          amountCents: data.amountCents,
          currency: data.currency,
        });
        return res.rows[0];
      });
    },
    auditAction: 'escrow.opened',
    auditResource: 'escrow',
    meterEventType: 'escrow_opened',
  });
}

export async function fundEscrow(tenantId: string, actorId: string, escrowId: string, paymentRef: string) {
  return transition(tenantId, actorId, escrowId, 'funded', 'funded', { paymentRef }, 'escrow.funded');
}

export async function releaseEscrow(tenantId: string, actorId: string, escrowId: string, payoutRef?: string) {
  return transition(tenantId, actorId, escrowId, 'released', 'released', { payoutRef }, 'escrow.released');
}

export async function refundEscrow(tenantId: string, actorId: string, escrowId: string, refundRef?: string) {
  return transition(tenantId, actorId, escrowId, 'refunded', 'refunded', { refundRef }, 'escrow.refunded');
}

export async function disputeEscrow(tenantId: string, actorId: string, escrowId: string, reason: string) {
  return transition(tenantId, actorId, escrowId, 'disputed', 'disputed', { reason }, 'escrow.disputed');
}

export async function resolveDispute(
  tenantId: string,
  actorId: string,
  escrowId: string,
  resolution: 'release' | 'refund',
  notes: string,
) {
  const to = resolution === 'release' ? 'released' : 'refunded';
  const result = await transition(tenantId, actorId, escrowId, to, 'dispute_resolved', { resolution, notes }, 'escrow.dispute_resolved');
  return result;
}

export async function getEscrowHistory(tenantId: string, escrowId: string) {
  const rows = await withTenantQuery(
    'SELECT event_type, payload_json, previous_hash, hash FROM escrow_events WHERE escrow_id = $1 AND tenant_id = $2 ORDER BY seq ASC',
    [escrowId, tenantId],
    tenantId,
  );
  const events: ChainEvent[] = rows.map((r: any) => ({
    scopeId: escrowId,
    eventType: r.event_type,
    payload: typeof r.payload_json === 'string' ? JSON.parse(r.payload_json) : r.payload_json,
    previousHash: r.previous_hash,
    hash: r.hash,
  }));
  const chainBreak = verifyChain(events);
  return { events, verified: chainBreak === null, chainBreak };
}
