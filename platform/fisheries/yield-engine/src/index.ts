/**
 * platform/fisheries/yield-engine/src/index.ts
 */

import { z } from 'zod';
import { withTenantQuery } from '../../../tenancy/src/index';
import { loadConfig, AppError, ErrorCode } from '../../../utils/src/index';
import { SpeciesRegistryService } from '../../species-registry/src/index';
import { ProcessingBatchService } from '../../processing-batch/src/index';
export { AppError, ErrorCode };

const ConfigSchema = z.object({
  enabled: z.boolean(),
  limits: z.object({
    underperformanceThresholdPoints: z.number().default(5),
  }),
});

function parseUserId(userId: any): string {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof userId === 'string' && uuidRegex.test(userId)) return userId;
  throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, ErrorCode.BAD_REQUEST);
}

function getConfig() {
  return loadConfig('fisheries-yield-engine', ConfigSchema);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export class YieldEngineService {
  static async computeYield(tenantId: string, batchId: string, userId: string) {
    const config = getConfig();
    if (!config.enabled) {
      throw new AppError('Yield engine disabled', ErrorCode.FORBIDDEN);
    }
    parseUserId(userId);

    const existing = await withTenantQuery(
      'SELECT id FROM fisheries_yield_records WHERE tenant_id = $1 AND batch_id = $2 LIMIT 1',
      [tenantId, batchId],
      tenantId
    );
    if (existing && existing.length > 0) {
      throw new AppError(`Yield has already been computed for batch ${batchId}.`, ErrorCode.CONFLICT);
    }

    const batch = await ProcessingBatchService.getBatch(tenantId, batchId);
    if (batch.status !== 'completed') {
      throw new AppError(
        `Batch ${batchId} must be completed before yield can be computed (currently "${batch.status}").`,
        ErrorCode.BAD_REQUEST
      );
    }

    const species = await SpeciesRegistryService.getSpecies(tenantId, batch.species_id);

    const rawInputWeightKg = Number(batch.raw_input_weight_kg);
    const finishedWeightKg = Number(batch.finished_weight_kg);
    const actualYieldPercent = round2((finishedWeightKg / rawInputWeightKg) * 100);

    const baselineYieldPercent =
      species.default_yield_rate_percent !== null && species.default_yield_rate_percent !== undefined
        ? Number(species.default_yield_rate_percent)
        : null;

    const deviationPoints = baselineYieldPercent !== null
      ? round2(actualYieldPercent - baselineYieldPercent)
      : null;

    const isUnderperforming = deviationPoints !== null
      && deviationPoints < -config.limits.underperformanceThresholdPoints;

    const res = await withTenantQuery(
      `INSERT INTO fisheries_yield_records (
        tenant_id, batch_id, species_id, actual_yield_percent,
        baseline_yield_percent, deviation_points, is_underperforming
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [
        tenantId, batchId, batch.species_id, actualYieldPercent,
        baselineYieldPercent, deviationPoints, isUnderperforming,
      ],
      tenantId
    );

    return res[0];
  }

  static async getYieldForBatch(tenantId: string, batchId: string) {
    const res = await withTenantQuery(
      'SELECT * FROM fisheries_yield_records WHERE tenant_id = $1 AND batch_id = $2',
      [tenantId, batchId],
      tenantId
    );
    if (!res || res.length === 0) {
      throw new AppError(`No yield record found for batch ${batchId}. Compute it first.`, ErrorCode.NOT_FOUND);
    }
    return res[0];
  }

  static async listYieldRecords(
    tenantId: string,
    filters: { speciesId?: string; underperformingOnly?: boolean } = {}
  ) {
    const conditions: string[] = ['tenant_id = $1'];
    const values: any[] = [tenantId];
    let idx = 2;

    if (filters.speciesId) {
      conditions.push(`species_id = $${idx}`);
      values.push(filters.speciesId);
      idx += 1;
    }
    if (filters.underperformingOnly) {
      conditions.push('is_underperforming = true');
    }

    const sql = `
      SELECT * FROM fisheries_yield_records
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC
    `;

    return await withTenantQuery(sql, values, tenantId);
  }

  static async getAverageYieldForSpecies(tenantId: string, speciesId: string): Promise<number | null> {
    const res = await withTenantQuery(
      'SELECT AVG(actual_yield_percent)::numeric as avg_yield FROM fisheries_yield_records WHERE tenant_id = $1 AND species_id = $2',
      [tenantId, speciesId],
      tenantId
    );
    const avg = res[0]?.avg_yield;
    return avg === null || avg === undefined ? null : round2(Number(avg));
  }
}
