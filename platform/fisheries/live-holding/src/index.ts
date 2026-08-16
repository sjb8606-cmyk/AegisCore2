/**
 * platform/fisheries/live-holding/src/index.ts
 *
 * From the original gap analysis: "Live Seafood / Tank Management — zero
 * coverage. Relevant given lobster (NB's flagship species) almost always
 * passes through live holding."
 *
 * The trackable unit here is a live holding RECORD tied to a real lot
 * (from the Lot Traceability Engine) — a portion of a lot placed into a
 * specific tank, with a live count that only ever moves via a real event:
 * placed, mortality, transfer, or removed. This is deliberately narrower
 * than aquaculture's full mortality-threshold/statutory-reporting scope
 * (that's real aquaculture-sector territory, not fisheries live-holding);
 * this module logs mortality honestly but does not enforce any statutory
 * threshold — that boundary is intentional, not an oversight.
 */

import { z } from 'zod';
import { withTenant, withTenantQuery } from '@platform/tenancy';
import { LotTraceabilityService } from '@platform/lot-traceability';
import { AppError, ErrorCode, parseUserId } from '@platform/utils';
export { AppError, ErrorCode };

export const RegisterTankInputSchema = z.object({
  tankCode: z.string().min(1),
  location: z.string().optional(),
  capacityCount: z.number().int().positive(),
});

export const PlaceLotInputSchema = z.object({
  tankId: z.string().uuid(),
  count: z.number().int().positive(),
  speciesId: z.string().uuid().optional(),
});

export const MortalityInputSchema = z.object({
  count: z.number().int().positive(),
  notes: z.string().optional(),
});

export const TransferInputSchema = z.object({
  toTankId: z.string().uuid(),
  notes: z.string().optional(),
});

export const RemoveInputSchema = z.object({
  reason: z.enum(['shipped_out', 'processed', 'other']),
  notes: z.string().optional(),
});

async function logEvent(
  client: any,
  tenantId: string,
  holdingRecordId: string,
  eventType: string,
  quantityDelta: number,
  actorId: string,
  extra: { toTankId?: string | null; notes?: string | null } = {},
) {
  await client.query(
    `INSERT INTO live_holding_events (
      tenant_id, holding_record_id, event_type, quantity_delta, to_tank_id, notes, recorded_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [tenantId, holdingRecordId, eventType, quantityDelta, extra.toTankId ?? null, extra.notes ?? null, actorId],
  );
}

export class LiveHoldingService {
  static async registerTank(tenantId: string, userId: string, data: any) {
    const cleanUserId = parseUserId(userId);
    const input = RegisterTankInputSchema.parse(data);

    return withTenant(tenantId, async (client: any) => {
      const res = await client.query(
        `INSERT INTO live_holding_tanks (tenant_id, tank_code, location, capacity_count, status, created_by)
         VALUES ($1, $2, $3, $4, 'active', $5)
         RETURNING *`,
        [tenantId, input.tankCode, input.location ?? null, input.capacityCount, cleanUserId],
      );
      return res.rows[0];
    });
  }

  static async listTanks(tenantId: string) {
    return withTenantQuery(
      `SELECT * FROM live_holding_tanks WHERE tenant_id = $1 ORDER BY tank_code ASC`,
      [tenantId],
      tenantId,
    );
  }

  static async placeLot(tenantId: string, userId: string, lotId: string, data: any) {
    const cleanUserId = parseUserId(userId);
    const input = PlaceLotInputSchema.parse(data);

    await LotTraceabilityService.getLot(tenantId, lotId);

    return withTenant(tenantId, async (client: any) => {
      const res = await client.query(
        `INSERT INTO live_holding_records (
          tenant_id, lot_id, tank_id, species_id, initial_count, current_count, status, placed_by
        ) VALUES ($1, $2, $3, $4, $5, $5, 'active', $6)
        RETURNING *`,
        [tenantId, lotId, input.tankId, input.speciesId ?? null, input.count, cleanUserId],
      );
      const record = res.rows[0];
      await logEvent(client, tenantId, record.id, 'placed', input.count, cleanUserId);
      return record;
    });
  }

  static async getHoldingRecord(tenantId: string, holdingRecordId: string) {
    const res = await withTenantQuery(
      `SELECT * FROM live_holding_records WHERE tenant_id = $1 AND id = $2`,
      [tenantId, holdingRecordId],
      tenantId,
    );
    if (!res || res.length === 0) {
      throw new AppError(`Holding record ${holdingRecordId} not found`, ErrorCode.NOT_FOUND);
    }
    return res[0];
  }

  static async listActiveHoldings(tenantId: string) {
    return withTenantQuery(
      `SELECT * FROM live_holding_records WHERE tenant_id = $1 AND status = 'active' ORDER BY placed_at DESC`,
      [tenantId],
      tenantId,
    );
  }

  static async getHoldingHistory(tenantId: string, holdingRecordId: string) {
    return withTenantQuery(
      `SELECT * FROM live_holding_events WHERE tenant_id = $1 AND holding_record_id = $2 ORDER BY recorded_at ASC`,
      [tenantId, holdingRecordId],
      tenantId,
    );
  }

  static async recordMortality(tenantId: string, userId: string, holdingRecordId: string, data: any) {
    const cleanUserId = parseUserId(userId);
    const input = MortalityInputSchema.parse(data);

    return withTenant(tenantId, async (client: any) => {
      const res = await client.query(
        `SELECT * FROM live_holding_records WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [tenantId, holdingRecordId],
      );
      const record = res.rows[0];
      if (!record) throw new AppError(`Holding record ${holdingRecordId} not found`, ErrorCode.NOT_FOUND);
      if (record.status !== 'active') {
        throw new AppError(`Holding record ${holdingRecordId} is not active`, ErrorCode.CONFLICT);
      }
      if (input.count > Number(record.current_count)) {
        throw new AppError(
          `Mortality count (${input.count}) exceeds current live count (${record.current_count})`,
          ErrorCode.UNPROCESSABLE,
        );
      }

      const newCount = Number(record.current_count) - input.count;
      const closesOut = newCount === 0;

      const updated = await client.query(
        `UPDATE live_holding_records
         SET current_count = $1,
             status = CASE WHEN $2 THEN 'closed' ELSE status END,
             closed_reason = CASE WHEN $2 THEN 'mortality_total_loss' ELSE closed_reason END,
             closed_at = CASE WHEN $2 THEN NOW() ELSE closed_at END
         WHERE tenant_id = $3 AND id = $4
         RETURNING *`,
        [newCount, closesOut, tenantId, holdingRecordId],
      );

      await logEvent(client, tenantId, holdingRecordId, 'mortality', -input.count, cleanUserId, {
        notes: input.notes ?? null,
      });

      return updated.rows[0];
    });
  }

  static async transfer(tenantId: string, userId: string, holdingRecordId: string, data: any) {
    const cleanUserId = parseUserId(userId);
    const input = TransferInputSchema.parse(data);

    return withTenant(tenantId, async (client: any) => {
      const res = await client.query(
        `SELECT * FROM live_holding_records WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [tenantId, holdingRecordId],
      );
      const record = res.rows[0];
      if (!record) throw new AppError(`Holding record ${holdingRecordId} not found`, ErrorCode.NOT_FOUND);
      if (record.status !== 'active') {
        throw new AppError(`Holding record ${holdingRecordId} is not active`, ErrorCode.CONFLICT);
      }

      const updated = await client.query(
        `UPDATE live_holding_records SET tank_id = $1 WHERE tenant_id = $2 AND id = $3 RETURNING *`,
        [input.toTankId, tenantId, holdingRecordId],
      );

      await logEvent(client, tenantId, holdingRecordId, 'transfer', 0, cleanUserId, {
        toTankId: input.toTankId,
        notes: input.notes ?? null,
      });

      return updated.rows[0];
    });
  }

  static async remove(tenantId: string, userId: string, holdingRecordId: string, data: any) {
    const cleanUserId = parseUserId(userId);
    const input = RemoveInputSchema.parse(data);

    return withTenant(tenantId, async (client: any) => {
      const res = await client.query(
        `SELECT * FROM live_holding_records WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [tenantId, holdingRecordId],
      );
      const record = res.rows[0];
      if (!record) throw new AppError(`Holding record ${holdingRecordId} not found`, ErrorCode.NOT_FOUND);
      if (record.status !== 'active') {
        throw new AppError(`Holding record ${holdingRecordId} is not active`, ErrorCode.CONFLICT);
      }

      const remaining = Number(record.current_count);

      const updated = await client.query(
        `UPDATE live_holding_records
         SET current_count = 0, status = 'closed', closed_reason = $1, closed_at = NOW()
         WHERE tenant_id = $2 AND id = $3
         RETURNING *`,
        [input.reason, tenantId, holdingRecordId],
      );

      await logEvent(client, tenantId, holdingRecordId, 'removed', -remaining, cleanUserId, {
        notes: input.notes ?? null,
      });

      return updated.rows[0];
    });
  }
}
