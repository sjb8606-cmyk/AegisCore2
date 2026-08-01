/**
 * platform/fisheries/compliance-reporter/src/index.ts
 */

import { z } from 'zod';
import { withTenantQuery } from '../../../tenancy/src/index';
import { loadConfig, AppError, ErrorCode } from '../../../utils/src/index';
export { AppError, ErrorCode };

const ConfigSchema = z.object({
  enabled: z.boolean(),
});

export const GenerateCatchReportInputSchema = z.object({
  fromDate: z.string().datetime(),
  toDate: z.string().datetime(),
}).refine((data) => new Date(data.fromDate) <= new Date(data.toDate), {
  message: 'fromDate must be before or equal to toDate',
});

function parseUserId(userId: any): string {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof userId === 'string' && uuidRegex.test(userId)) return userId;
  throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, ErrorCode.BAD_REQUEST);
}

function getConfig() {
  return loadConfig('fisheries-compliance-reporter', ConfigSchema);
}

export class ComplianceReporterService {
  static async generateCatchReport(tenantId: string, userId: string, filters: any) {
    const config = getConfig();
    if (!config.enabled) {
      throw new AppError('Compliance reporting disabled', ErrorCode.FORBIDDEN);
    }
    const cleanUserId = parseUserId(userId);
    const input = GenerateCatchReportInputSchema.parse(filters);

    const rows = await withTenantQuery(
      `SELECT
        s.id as species_id,
        s.common_name,
        s.scientific_name,
        COUNT(sh.id)::int as shipment_count,
        COALESCE(SUM(sh.weight_kg), 0)::numeric as total_weight_kg,
        ARRAY_AGG(DISTINCT sh.vessel_name) as vessels,
        ARRAY_AGG(DISTINCT sh.catch_zone) FILTER (WHERE sh.catch_zone IS NOT NULL) as catch_zones
       FROM fisheries_shipments sh
       JOIN fisheries_species s ON s.id = sh.species_id
       WHERE sh.tenant_id = $1 AND sh.catch_date >= $2 AND sh.catch_date <= $3 AND sh.deleted_at IS NULL
       GROUP BY s.id, s.common_name, s.scientific_name
       ORDER BY total_weight_kg DESC`,
      [tenantId, input.fromDate, input.toDate],
      tenantId
    );

    const speciesBreakdown = rows || [];
    const totalWeightKg = speciesBreakdown.reduce((sum: number, r: any) => sum + Number(r.total_weight_kg), 0);
    const totalShipments = speciesBreakdown.reduce((sum: number, r: any) => sum + Number(r.shipment_count), 0);

    const summary = {
      from_date: input.fromDate,
      to_date: input.toDate,
      species_breakdown: speciesBreakdown,
      total_weight_kg: totalWeightKg,
      total_shipments: totalShipments,
    };

    const res = await withTenantQuery(
      `INSERT INTO fisheries_compliance_reports (
        tenant_id, from_date, to_date, summary, generated_by
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING *`,
      [tenantId, input.fromDate, input.toDate, JSON.stringify(summary), cleanUserId],
      tenantId
    );

    return res[0];
  }

  static async getReport(tenantId: string, reportId: string) {
    const res = await withTenantQuery(
      'SELECT * FROM fisheries_compliance_reports WHERE tenant_id = $1 AND id = $2',
      [tenantId, reportId],
      tenantId
    );
    if (!res || res.length === 0) {
      throw new AppError(`Compliance report ${reportId} not found`, ErrorCode.NOT_FOUND);
    }
    return res[0];
  }

  static async listReports(tenantId: string) {
    return await withTenantQuery(
      'SELECT id, from_date, to_date, generated_by, created_at FROM fisheries_compliance_reports WHERE tenant_id = $1 ORDER BY created_at DESC',
      [tenantId],
      tenantId
    );
  }
}
