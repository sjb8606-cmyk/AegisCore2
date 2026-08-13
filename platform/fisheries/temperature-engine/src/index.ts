/**
 * platform/fisheries/temperature-engine/src/index.ts
 *
 * From the original gap analysis: "Temperature Engine — zero coverage
 * confirmed. Real, bounded scope: log a reading, check against
 * species/stage threshold, trigger a hold on deviation."
 *
 * That last part — "trigger a hold on deviation" — is now a real,
 * concrete action rather than a vague intention: a deviation calls
 * RecallEngineService.cascadeHold on the lot, which holds it AND
 * everything already downstream of it. This is what "log a reading" was
 * always supposed to connect to.
 */

import { z } from 'zod';
import { withTenant, withTenantQuery } from '@platform/tenancy';
import { LotTraceabilityService } from '@platform/lot-traceability';
import { RecallEngineService } from '@platform/recall-engine';
import { AppError, ErrorCode } from '@platform/utils';
export { AppError, ErrorCode };

export const StageSchema = z.enum(['receiving', 'storage', 'processing', 'shipping']);

export const SetThresholdInputSchema = z.object({
  speciesId: z.string().uuid().optional(),
  stage: StageSchema,
  minCelsius: z.number(),
  maxCelsius: z.number(),
}).refine((d) => d.maxCelsius >= d.minCelsius, {
  message: 'maxCelsius must be greater than or equal to minCelsius',
});

export const LogReadingInputSchema = z.object({
  stage: StageSchema,
  readingCelsius: z.number(),
  deviceId: z.string().optional(),
  notes: z.string().optional(),
});

function parseUserId(userId: any): string {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof userId === 'string' && uuidRegex.test(userId)) return userId;
  throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, ErrorCode.BAD_REQUEST);
}

export class TemperatureEngineService {
  static async setThreshold(tenantId: string, userId: string, data: any) {
    const cleanUserId = parseUserId(userId);
    const input = SetThresholdInputSchema.parse(data);

    return withTenant(tenantId, async (client: any) => {
      const res = await client.query(
        `INSERT INTO temperature_thresholds (tenant_id, species_id, stage, min_celsius, max_celsius, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [tenantId, input.speciesId ?? null, input.stage, input.minCelsius, input.maxCelsius, cleanUserId],
      );
      return res.rows[0];
    });
  }

  static async getThreshold(tenantId: string, speciesId: string | null, stage: string) {
    if (speciesId) {
      const specific = await withTenantQuery(
        `SELECT * FROM temperature_thresholds
         WHERE tenant_id = $1 AND species_id = $2 AND stage = $3
         ORDER BY created_at DESC LIMIT 1`,
        [tenantId, speciesId, stage],
        tenantId,
      );
      if (specific.length > 0) return specific[0];
    }

    const generic = await withTenantQuery(
      `SELECT * FROM temperature_thresholds
       WHERE tenant_id = $1 AND species_id IS NULL AND stage = $2
       ORDER BY created_at DESC LIMIT 1`,
      [tenantId, stage],
      tenantId,
    );
    return generic[0] ?? null;
  }

  static async logReading(tenantId: string, userId: string, lotId: string, data: any) {
    const cleanUserId = parseUserId(userId);
    const input = LogReadingInputSchema.parse(data);

    const lot = await LotTraceabilityService.getLot(tenantId, lotId);
    const speciesId = lot?.metadata?.speciesId ?? null;

    const threshold = await this.getThreshold(tenantId, speciesId, input.stage);
    const hasThreshold = threshold !== null;
    const isDeviation = hasThreshold
      ? input.readingCelsius < Number(threshold.min_celsius) || input.readingCelsius > Number(threshold.max_celsius)
      : false;

    const reading = await withTenant(tenantId, async (client: any) => {
      const res = await client.query(
        `INSERT INTO temperature_readings (
          tenant_id, lot_id, stage, reading_celsius, device_id, notes,
          threshold_id, is_deviation, recorded_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *`,
        [
          tenantId,
          lotId,
          input.stage,
          input.readingCelsius,
          input.deviceId ?? null,
          input.notes ?? null,
          threshold?.id ?? null,
          isDeviation,
          cleanUserId,
        ],
      );
      return res.rows[0];
    });

    let holdReport = null;
    if (isDeviation) {
      holdReport = await RecallEngineService.cascadeHold(tenantId, cleanUserId, lotId, {
        reason: `Temperature deviation: ${input.readingCelsius}\u00b0C outside [${threshold.min_celsius}, ${threshold.max_celsius}]\u00b0C at ${input.stage}`,
      });
    }

    return {
      reading,
      hasThreshold,
      isDeviation,
      threshold,
      holdReport,
    };
  }

  static async getReadingsForLot(tenantId: string, lotId: string) {
    return withTenantQuery(
      `SELECT * FROM temperature_readings WHERE tenant_id = $1 AND lot_id = $2 ORDER BY recorded_at DESC`,
      [tenantId, lotId],
      tenantId,
    );
  }
}
