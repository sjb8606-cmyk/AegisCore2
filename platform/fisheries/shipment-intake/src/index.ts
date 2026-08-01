/**
 * platform/fisheries/shipment-intake/src/index.ts
 */

import { z } from 'zod';
import { withTenantQuery } from '../../../tenancy/src/index';
import { loadConfig, AppError, ErrorCode } from '../../../utils/src/index';
import { SpeciesRegistryService } from '../../species-registry/src/index';
export { AppError, ErrorCode };

const LB_TO_KG = 0.45359237;

const ConfigSchema = z.object({
  enabled: z.boolean(),
  limits: z.object({
    shipmentListPageSize: z.number().default(100),
  }),
});

export const LogShipmentInputSchema = z.object({
  speciesId: z.string().uuid(),
  vesselName: z.string().min(1),
  catchDate: z.string().datetime(),
  weight: z.number().positive(),
  weightUnit: z.enum(['kg', 'lb']).default('kg'),
  qualityGrade: z.enum(['premium', 'standard', 'processing']),
  catchZone: z.string().optional(),
  notes: z.string().optional(),
});

function parseUserId(userId: any): string {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof userId === 'string' && uuidRegex.test(userId)) return userId;
  throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, ErrorCode.BAD_REQUEST);
}

function getConfig() {
  return loadConfig('fisheries-shipment-intake', ConfigSchema);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export class ShipmentIntakeService {
  static async logShipment(tenantId: string, userId: string, data: any) {
    const config = getConfig();
    if (!config.enabled) {
      throw new AppError('Shipment intake disabled', ErrorCode.FORBIDDEN);
    }
    const cleanUserId = parseUserId(userId);
    const input = LogShipmentInputSchema.parse(data);

    const species = await SpeciesRegistryService.getSpecies(tenantId, input.speciesId);
    if (!species.is_active) {
      throw new AppError(
        `Species "${species.common_name}" is inactive and cannot receive new shipments.`,
        ErrorCode.FORBIDDEN
      );
    }

    const weightKg = input.weightUnit === 'lb'
      ? round2(input.weight * LB_TO_KG)
      : input.weight;

    const res = await withTenantQuery(
      `INSERT INTO fisheries_shipments (
        tenant_id, species_id, vessel_name, catch_date, weight_kg,
        original_weight, original_unit, quality_grade, catch_zone, notes, logged_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        tenantId,
        input.speciesId,
        input.vesselName,
        input.catchDate,
        weightKg,
        input.weight,
        input.weightUnit,
        input.qualityGrade,
        input.catchZone ?? null,
        input.notes ?? null,
        cleanUserId,
      ],
      tenantId
    );

    return res[0];
  }

  static async getShipment(tenantId: string, shipmentId: string) {
    const res = await withTenantQuery(
      'SELECT * FROM fisheries_shipments WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL',
      [tenantId, shipmentId],
      tenantId
    );
    if (!res || res.length === 0) {
      throw new AppError(`Shipment ${shipmentId} not found`, ErrorCode.NOT_FOUND);
    }
    return res[0];
  }

  static async listShipments(
    tenantId: string,
    filters: { speciesId?: string; fromDate?: string; toDate?: string } = {}
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
    if (filters.fromDate) {
      conditions.push(`catch_date >= $${idx}`);
      values.push(filters.fromDate);
      idx += 1;
    }
    if (filters.toDate) {
      conditions.push(`catch_date <= $${idx}`);
      values.push(filters.toDate);
      idx += 1;
    }

    const sql = `
      SELECT * FROM fisheries_shipments
      WHERE ${conditions.join(' AND ')}
      ORDER BY catch_date DESC
      LIMIT ${config.limits.shipmentListPageSize}
    `;

    return await withTenantQuery(sql, values, tenantId);
  }

  static async getTotalWeightForSpecies(
    tenantId: string,
    speciesId: string,
    filters: { fromDate?: string; toDate?: string } = {}
  ): Promise<number> {
    const conditions: string[] = ['tenant_id = $1', 'species_id = $2', 'deleted_at IS NULL'];
    const values: any[] = [tenantId, speciesId];
    let idx = 3;

    if (filters.fromDate) {
      conditions.push(`catch_date >= $${idx}`);
      values.push(filters.fromDate);
      idx += 1;
    }
    if (filters.toDate) {
      conditions.push(`catch_date <= $${idx}`);
      values.push(filters.toDate);
      idx += 1;
    }

    const res = await withTenantQuery(
      `SELECT COALESCE(SUM(weight_kg), 0)::numeric as total_weight_kg
       FROM fisheries_shipments WHERE ${conditions.join(' AND ')}`,
      values,
      tenantId
    );

    return Number(res[0]?.total_weight_kg ?? 0);
  }
}
