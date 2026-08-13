/**
 * platform/lot-traceability/src/index.ts
 *
 * The foundational shared-spine core the roadmap called for: a real lot as
 * the unit of traceability, instead of a shipment or batch record standing
 * in for one. Deliberately sector-agnostic — fisheries, aquaculture, and
 * agriculture all create/split/merge/hold/trace lots through this same
 * service, with sector-specific meaning attached only via `sourceType`,
 * `sourceRefTable`/`sourceRefId` (a pointer back to e.g. a
 * fisheries_shipments row or a future agriculture harvest_events row), and
 * free-form `metadata`.
 *
 * Every mutation appends a hash-chained event (see ./hash.ts) so a lot's
 * history can be verified, not just read. traceUpstream/traceDownstream
 * are the graph-walk primitives the Recall Engine (next up in the build
 * order) will call directly rather than reimplementing.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { withTenantQuery, withTenant } from '@platform/tenancy';
import { AppError, ErrorCode } from '@platform/utils';
export { AppError, ErrorCode };
import { computeEventHash, GENESIS_HASH } from './hash';
export { computeEventHash, GENESIS_HASH };

const SourceTypeSchema = z.enum(['harvest', 'shipment', 'purchase', 'batch', 'other']);

export const CreateLotInputSchema = z.object({
  lotCode: z.string().min(1).optional(),
  sourceType: SourceTypeSchema,
  sourceRefTable: z.string().min(1).optional(),
  sourceRefId: z.string().uuid().optional(),
  quantity: z.number().positive(),
  unit: z.string().min(1),
  metadata: z.record(z.any()).optional(),
});

export const SplitLotInputSchema = z.object({
  splits: z
    .array(
      z.object({
        quantity: z.number().positive(),
        lotCode: z.string().min(1).optional(),
        metadata: z.record(z.any()).optional(),
      }),
    )
    .min(2, 'Splitting a lot requires at least 2 resulting lots'),
});

export const MergeLotsInputSchema = z.object({
  lotIds: z.array(z.string().uuid()).min(2, 'Merging requires at least 2 source lots'),
  lotCode: z.string().min(1).optional(),
  unit: z.string().min(1),
});

export const HoldLotInputSchema = z.object({
  reason: z.string().min(1),
});

function parseUserId(userId: any): string {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof userId === 'string' && uuidRegex.test(userId)) return userId;
  throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, ErrorCode.BAD_REQUEST);
}

function generateLotCode(): string {
  return `LOT-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
}

async function getLatestEventHash(client: any, tenantId: string, lotId: string): Promise<string> {
  const res = await client.query(
    `SELECT hash FROM lot_events WHERE tenant_id = $1 AND lot_id = $2 ORDER BY created_at DESC, id DESC LIMIT 1`,
    [tenantId, lotId],
  );
  return res.rows[0]?.hash ?? GENESIS_HASH;
}

async function appendEvent(
  client: any,
  tenantId: string,
  lotId: string,
  eventType: string,
  payload: Record<string, unknown>,
  actorId: string,
): Promise<string> {
  const prevHash = await getLatestEventHash(client, tenantId, lotId);
  const hash = computeEventHash(lotId, eventType, payload, prevHash);
  await client.query(
    `INSERT INTO lot_events (tenant_id, lot_id, event_type, payload, actor_id, prev_hash, hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [tenantId, lotId, eventType, JSON.stringify(payload), actorId, prevHash, hash],
  );
  return hash;
}

const NON_SPLITTABLE_STATUSES = ['held', 'consumed', 'closed'];
const NON_MERGEABLE_STATUSES = ['held', 'consumed', 'closed'];

/**
 * Create a lot using a caller-supplied client, inside a transaction the
 * caller already owns. This is what makes lot creation composable with
 * other services' own inserts — e.g. shipment-intake calling this from
 * inside its own withTenant() block, so "shipment saved" and "lot created"
 * either both happen or neither does, instead of being two independent
 * transactions that could succeed/fail independently and leave a shipment
 * with no corresponding lot (or vice versa).
 *
 * LotTraceabilityService.createLot (below) is a thin wrapper around this
 * for standalone callers that don't already have a transaction open.
 */
export async function createLotWithClient(client: any, tenantId: string, userId: string, data: any) {
  const cleanUserId = parseUserId(userId);
  const input = CreateLotInputSchema.parse(data);
  const lotCode = input.lotCode ?? generateLotCode();

  const res = await client.query(
    `INSERT INTO lots (
      tenant_id, lot_code, status, source_type, source_ref_table, source_ref_id,
      quantity, unit, metadata, created_by
    ) VALUES ($1, $2, 'open', $3, $4, $5, $6, $7, $8, $9)
    RETURNING *`,
    [
      tenantId,
      lotCode,
      input.sourceType,
      input.sourceRefTable ?? null,
      input.sourceRefId ?? null,
      input.quantity,
      input.unit,
      JSON.stringify(input.metadata ?? {}),
      cleanUserId,
    ],
  );
  const lot = res.rows[0];

  await appendEvent(
    client,
    tenantId,
    lot.id,
    'created',
    { lotCode, quantity: input.quantity, unit: input.unit, sourceType: input.sourceType },
    cleanUserId,
  );

  return lot;
}

export class LotTraceabilityService {
  static async createLot(tenantId: string, userId: string, data: any) {
    return withTenant(tenantId, (client: any) => createLotWithClient(client, tenantId, userId, data));
  }

  static async getLot(tenantId: string, lotId: string) {
    const res = await withTenantQuery(
      `SELECT * FROM lots WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [tenantId, lotId],
      tenantId,
    );
    if (!res || res.length === 0) {
      throw new AppError(`Lot ${lotId} not found`, ErrorCode.NOT_FOUND);
    }
    return res[0];
  }

  static async getLotHistory(tenantId: string, lotId: string) {
    return withTenantQuery(
      `SELECT * FROM lot_events WHERE tenant_id = $1 AND lot_id = $2 ORDER BY created_at ASC, id ASC`,
      [tenantId, lotId],
      tenantId,
    );
  }

  static async splitLot(tenantId: string, userId: string, parentLotId: string, data: any) {
    const cleanUserId = parseUserId(userId);
    const input = SplitLotInputSchema.parse(data);

    return withTenant(tenantId, async (client: any) => {
      const parentRes = await client.query(
        `SELECT * FROM lots WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL FOR UPDATE`,
        [tenantId, parentLotId],
      );
      const parent = parentRes.rows[0];
      if (!parent) throw new AppError(`Lot ${parentLotId} not found`, ErrorCode.NOT_FOUND);
      if (NON_SPLITTABLE_STATUSES.includes(parent.status)) {
        throw new AppError(`Lot ${parentLotId} is ${parent.status} and cannot be split`, ErrorCode.CONFLICT);
      }

      const totalSplit = input.splits.reduce((sum, s) => sum + s.quantity, 0);
      if (totalSplit > Number(parent.quantity) + 1e-9) {
        throw new AppError(
          `Split quantities (${totalSplit}) exceed parent lot quantity (${parent.quantity})`,
          ErrorCode.UNPROCESSABLE,
        );
      }

      const children = [];
      for (const split of input.splits) {
        const lotCode = split.lotCode ?? generateLotCode();
        const childRes = await client.query(
          `INSERT INTO lots (
            tenant_id, lot_code, status, source_type, source_ref_table, source_ref_id,
            quantity, unit, metadata, created_by
          ) VALUES ($1, $2, 'open', $3, $4, $5, $6, $7, $8, $9)
          RETURNING *`,
          [
            tenantId,
            lotCode,
            parent.source_type,
            parent.source_ref_table,
            parent.source_ref_id,
            split.quantity,
            parent.unit,
            JSON.stringify(split.metadata ?? {}),
            cleanUserId,
          ],
        );
        const child = childRes.rows[0];

        await client.query(
          `INSERT INTO lot_relationships (tenant_id, parent_lot_id, child_lot_id, relationship_type)
           VALUES ($1, $2, $3, 'split')`,
          [tenantId, parentLotId, child.id],
        );

        await appendEvent(
          client,
          tenantId,
          child.id,
          'created',
          { lotCode, quantity: split.quantity, splitFrom: parentLotId },
          cleanUserId,
        );

        children.push(child);
      }

      await client.query(
        `UPDATE lots SET status = 'consumed', updated_at = NOW() WHERE tenant_id = $1 AND id = $2`,
        [tenantId, parentLotId],
      );
      await appendEvent(
        client,
        tenantId,
        parentLotId,
        'split',
        { childLotIds: children.map((c: any) => c.id), totalSplit },
        cleanUserId,
      );

      return { parent: { ...parent, status: 'consumed' }, children };
    });
  }

  static async mergeLots(tenantId: string, userId: string, data: any) {
    const cleanUserId = parseUserId(userId);
    const input = MergeLotsInputSchema.parse(data);

    return withTenant(tenantId, async (client: any) => {
      const parentsRes = await client.query(
        `SELECT * FROM lots WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL FOR UPDATE`,
        [tenantId, input.lotIds],
      );
      const parents = parentsRes.rows;
      if (parents.length !== input.lotIds.length) {
        throw new AppError('One or more lots to merge were not found', ErrorCode.NOT_FOUND);
      }
      const blocked = parents.find((p: any) => NON_MERGEABLE_STATUSES.includes(p.status));
      if (blocked) {
        throw new AppError(`Lot ${blocked.id} is ${blocked.status} and cannot be merged`, ErrorCode.CONFLICT);
      }

      const totalQuantity = parents.reduce((sum: number, p: any) => sum + Number(p.quantity), 0);
      const lotCode = input.lotCode ?? generateLotCode();

      const mergedRes = await client.query(
        `INSERT INTO lots (
          tenant_id, lot_code, status, source_type, source_ref_table, source_ref_id,
          quantity, unit, metadata, created_by
        ) VALUES ($1, $2, 'open', 'other', NULL, NULL, $3, $4, $5, $6)
        RETURNING *`,
        [tenantId, lotCode, totalQuantity, input.unit, JSON.stringify({ mergedFrom: input.lotIds }), cleanUserId],
      );
      const merged = mergedRes.rows[0];

      for (const parent of parents) {
        await client.query(
          `INSERT INTO lot_relationships (tenant_id, parent_lot_id, child_lot_id, relationship_type)
           VALUES ($1, $2, $3, 'merge')`,
          [tenantId, parent.id, merged.id],
        );
        await client.query(
          `UPDATE lots SET status = 'consumed', updated_at = NOW() WHERE tenant_id = $1 AND id = $2`,
          [tenantId, parent.id],
        );
        await appendEvent(client, tenantId, parent.id, 'merged', { mergedInto: merged.id }, cleanUserId);
      }

      await appendEvent(
        client,
        tenantId,
        merged.id,
        'created',
        { lotCode, quantity: totalQuantity, mergedFrom: input.lotIds },
        cleanUserId,
      );

      return merged;
    });
  }

  static async holdLot(tenantId: string, userId: string, lotId: string, data: any) {
    const cleanUserId = parseUserId(userId);
    const input = HoldLotInputSchema.parse(data);

    return withTenant(tenantId, async (client: any) => {
      const res = await client.query(
        `SELECT * FROM lots WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL FOR UPDATE`,
        [tenantId, lotId],
      );
      const lot = res.rows[0];
      if (!lot) throw new AppError(`Lot ${lotId} not found`, ErrorCode.NOT_FOUND);
      if (lot.status === 'held') throw new AppError(`Lot ${lotId} is already on hold`, ErrorCode.CONFLICT);

      const updated = await client.query(
        `UPDATE lots SET status = 'held', updated_at = NOW() WHERE tenant_id = $1 AND id = $2 RETURNING *`,
        [tenantId, lotId],
      );
      await appendEvent(client, tenantId, lotId, 'held', { reason: input.reason, previousStatus: lot.status }, cleanUserId);
      return updated.rows[0];
    });
  }

  static async releaseLot(tenantId: string, userId: string, lotId: string) {
    const cleanUserId = parseUserId(userId);

    return withTenant(tenantId, async (client: any) => {
      const res = await client.query(
        `SELECT * FROM lots WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL FOR UPDATE`,
        [tenantId, lotId],
      );
      const lot = res.rows[0];
      if (!lot) throw new AppError(`Lot ${lotId} not found`, ErrorCode.NOT_FOUND);
      if (lot.status !== 'held') throw new AppError(`Lot ${lotId} is not on hold`, ErrorCode.CONFLICT);

      const updated = await client.query(
        `UPDATE lots SET status = 'released', updated_at = NOW() WHERE tenant_id = $1 AND id = $2 RETURNING *`,
        [tenantId, lotId],
      );
      await appendEvent(client, tenantId, lotId, 'released', {}, cleanUserId);
      return updated.rows[0];
    });
  }

  static async traceUpstream(tenantId: string, lotId: string) {
    return withTenantQuery(
      `WITH RECURSIVE upstream AS (
         SELECT parent_lot_id, child_lot_id, relationship_type, 1 AS depth
         FROM lot_relationships
         WHERE tenant_id = $1 AND child_lot_id = $2
         UNION ALL
         SELECT r.parent_lot_id, r.child_lot_id, r.relationship_type, u.depth + 1
         FROM lot_relationships r
         INNER JOIN upstream u ON r.child_lot_id = u.parent_lot_id
         WHERE r.tenant_id = $1 AND u.depth < 50
       )
       SELECT l.*, u.relationship_type, u.depth
       FROM upstream u
       JOIN lots l ON l.id = u.parent_lot_id AND l.tenant_id = $1
       ORDER BY u.depth ASC`,
      [tenantId, lotId],
      tenantId,
    );
  }

  static async traceDownstream(tenantId: string, lotId: string) {
    return withTenantQuery(
      `WITH RECURSIVE downstream AS (
         SELECT parent_lot_id, child_lot_id, relationship_type, 1 AS depth
         FROM lot_relationships
         WHERE tenant_id = $1 AND parent_lot_id = $2
         UNION ALL
         SELECT r.parent_lot_id, r.child_lot_id, r.relationship_type, d.depth + 1
         FROM lot_relationships r
         INNER JOIN downstream d ON r.parent_lot_id = d.child_lot_id
         WHERE r.tenant_id = $1 AND d.depth < 50
       )
       SELECT l.*, d.relationship_type, d.depth
       FROM downstream d
       JOIN lots l ON l.id = d.child_lot_id AND l.tenant_id = $1
       ORDER BY d.depth ASC`,
      [tenantId, lotId],
      tenantId,
    );
  }
}
