/**
 * platform/fisheries/processing-batch/src/index.ts
 */

import { z } from 'zod';
import { withTenantQuery } from '../../../tenancy/src/index';
import { loadConfig, AppError, ErrorCode } from '../../../utils/src/index';
import { SpeciesRegistryService } from '../../species-registry/src/index';
import { ShipmentIntakeService } from '../../shipment-intake/src/index';
export { AppError, ErrorCode };

const ConfigSchema = z.object({
  enabled: z.boolean(),
  limits: z.object({
    batchListPageSize: z.number().default(100),
  }),
});

export const CreateBatchInputSchema = z.object({
  speciesId: z.string().uuid(),
  shipmentIds: z.array(z.string().uuid()).min(1),
  startedAt: z.string().datetime(),
  notes: z.string().optional(),
});

export const CompleteBatchInputSchema = z.object({
  finishedWeightKg: z.number().positive(),
  completedAt: z.string().datetime(),
});

function parseUserId(userId: any): string {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof userId === 'string' && uuidRegex.test(userId)) return userId;
  throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, ErrorCode.BAD_REQUEST);
}

function getConfig() {
  return loadConfig('fisheries-processing-batch', ConfigSchema);
}

export class ProcessingBatchService {
  static async createBatch(tenantId: string, userId: string, data: any) {
    const config = getConfig();
    if (!config.enabled) {
      throw new AppError('Processing batch tracking disabled', ErrorCode.FORBIDDEN);
    }
    const cleanUserId = parseUserId(userId);
    const input = CreateBatchInputSchema.parse(data);

    const species = await SpeciesRegistryService.getSpecies(tenantId, input.speciesId);
    if (!species.is_active) {
      throw new AppError(
        `Species "${species.common_name}" is inactive and cannot start a new batch.`,
        ErrorCode.FORBIDDEN
      );
    }

    let rawInputWeightKg = 0;
    for (const shipmentId of input.shipmentIds) {
      const shipment = await ShipmentIntakeService.getShipment(tenantId, shipmentId);

      if (shipment.species_id !== input.speciesId) {
        throw new AppError(
          `Shipment ${shipmentId} is for a different species than this batch.`,
          ErrorCode.BAD_REQUEST
        );
      }

      const claimedRes = await withTenantQuery(
        'SELECT batch_id FROM fisheries_batch_shipments WHERE tenant_id = $1 AND shipment_id = $2 LIMIT 1',
        [tenantId, shipmentId],
        tenantId
      );
      if (claimedRes && claimedRes.length > 0) {
        throw new AppError(
          `Shipment ${shipmentId} is already claimed by another batch.`,
          ErrorCode.CONFLICT
        );
      }

      rawInputWeightKg += Number(shipment.weight_kg);
    }

    const batchRes = await withTenantQuery(
      `INSERT INTO fisheries_processing_batches (
        tenant_id, species_id, status, raw_input_weight_kg, started_at, notes, created_by
      ) VALUES ($1, $2, 'open', $3, $4, $5, $6)
      RETURNING *`,
      [tenantId, input.speciesId, rawInputWeightKg, input.startedAt, input.notes ?? null, cleanUserId],
      tenantId
    );
    const batch = batchRes[0];

    for (const shipmentId of input.shipmentIds) {
      await withTenantQuery(
        'INSERT INTO fisheries_batch_shipments (tenant_id, batch_id, shipment_id) VALUES ($1, $2, $3)',
        [tenantId, batch.id, shipmentId],
        tenantId
      );
    }

    return batch;
  }

  static async completeBatch(tenantId: string, batchId: string, userId: string, data: any) {
    parseUserId(userId);
    const input = CompleteBatchInputSchema.parse(data);

    const batch = await ProcessingBatchService.getBatch(tenantId, batchId);

    if (batch.status !== 'open') {
      throw new AppError(
        `Batch ${batchId} is already "${batch.status}" and cannot be completed again.`,
        ErrorCode.CONFLICT
      );
    }

    if (input.finishedWeightKg > Number(batch.raw_input_weight_kg)) {
      throw new AppError(
        `Finished weight (${input.finishedWeightKg}kg) cannot exceed raw input weight (${batch.raw_input_weight_kg}kg).`,
        ErrorCode.BAD_REQUEST
      );
    }

    const res = await withTenantQuery(
      `UPDATE fisheries_processing_batches
       SET status = 'completed', finished_weight_kg = $1, completed_at = $2
       WHERE tenant_id = $3 AND id = $4
       RETURNING *`,
      [input.finishedWeightKg, input.completedAt, tenantId, batchId],
      tenantId
    );

    return res[0];
  }

  static async cancelBatch(tenantId: string, batchId: string, userId: string) {
    parseUserId(userId);
    const batch = await ProcessingBatchService.getBatch(tenantId, batchId);

    if (batch.status !== 'open') {
      throw new AppError(
        `Batch ${batchId} is already "${batch.status}" and cannot be cancelled.`,
        ErrorCode.CONFLICT
      );
    }

    const res = await withTenantQuery(
      `UPDATE fisheries_processing_batches SET status = 'cancelled'
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [tenantId, batchId],
      tenantId
    );

    return res[0];
  }

  static async getBatch(tenantId: string, batchId: string) {
    const res = await withTenantQuery(
      'SELECT * FROM fisheries_processing_batches WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL',
      [tenantId, batchId],
      tenantId
    );
    if (!res || res.length === 0) {
      throw new AppError(`Batch ${batchId} not found`, ErrorCode.NOT_FOUND);
    }
    return res[0];
  }

  static async listBatches(
    tenantId: string,
    filters: { speciesId?: string; status?: 'open' | 'completed' | 'cancelled' } = {}
  ) {
    const config = getConfig();
    const conditions: string[] = ['tenant_id = $1', 'deleted_at IS NULL'];
    const values: any[] = [tenantId];
    let idx = 2;

    if (filters.speciesId) {
      conditions.push(`species_id = $${idx}`);
      values.push(filters.speciesId);
      idx += 1;
    }
    if (filters.status) {
      conditions.push(`status = $${idx}`);
      values.push(filters.status);
      idx += 1;
    }

    const sql = `
      SELECT * FROM fisheries_processing_batches
      WHERE ${conditions.join(' AND ')}
      ORDER BY started_at DESC
      LIMIT ${config.limits.batchListPageSize}
    `;

    return await withTenantQuery(sql, values, tenantId);
  }
}
