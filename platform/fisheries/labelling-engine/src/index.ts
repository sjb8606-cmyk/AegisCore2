/**
 * platform/fisheries/labelling-engine/src/index.ts
 *
 * From the original gap analysis: "Labelling Engine — zero coverage.
 * Bilingual field validation, rules differ by market (domestic/US/EU)."
 *
 * Two deliberate, honest boundaries in this design:
 *
 * 1. Required-field rules per market are TENANT-CONFIGURABLE, not
 *    hardcoded as if this system knows CFIA/USDA/EU labelling law
 *    authoritatively. A compliance officer sets the real required fields
 *    for their situation; the engine enforces them deterministically once
 *    set, and is honest — not silently "valid" — when no rules exist yet
 *    for a market.
 *
 * 2. species-registry (checked directly) has no French name field — only
 *    commonName in English. So bilingual validation does NOT fabricate a
 *    French species name from a lookup that doesn't exist. It requires
 *    the caller to supply speciesNameFr as real input when generating a
 *    label for a market that requires it, and flags it as missing
 *    otherwise, same as any other missing required field.
 */

import { z } from 'zod';
import { withTenant, withTenantQuery } from '@platform/tenancy';
import { LotTraceabilityService } from '@platform/lot-traceability';
import { SpeciesRegistryService } from '@platform/species-registry';
import { AppError, ErrorCode } from '@platform/utils';
export { AppError, ErrorCode };

export const MarketSchema = z.enum(['domestic', 'us_export', 'eu_export']);

export const SetMarketRulesInputSchema = z.object({
  market: MarketSchema,
  requiredFields: z.array(z.string().min(1)).min(1),
  bilingualRequired: z.boolean().default(false),
});

export const GenerateLabelInputSchema = z.object({
  market: MarketSchema,
  speciesNameFr: z.string().optional(),
  additionalFields: z.record(z.string()).optional(),
});

function parseUserId(userId: any): string {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof userId === 'string' && uuidRegex.test(userId)) return userId;
  throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, ErrorCode.BAD_REQUEST);
}

export class LabellingEngineService {
  static async setMarketRules(tenantId: string, userId: string, data: any) {
    const cleanUserId = parseUserId(userId);
    const input = SetMarketRulesInputSchema.parse(data);

    return withTenant(tenantId, async (client: any) => {
      const res = await client.query(
        `INSERT INTO label_market_rules (tenant_id, market, required_fields, bilingual_required, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [tenantId, input.market, JSON.stringify(input.requiredFields), input.bilingualRequired, cleanUserId],
      );
      return res.rows[0];
    });
  }

  static async getMarketRules(tenantId: string, market: string) {
    const res = await withTenantQuery(
      `SELECT * FROM label_market_rules WHERE tenant_id = $1 AND market = $2 ORDER BY created_at DESC LIMIT 1`,
      [tenantId, market],
      tenantId,
    );
    return res[0] ?? null;
  }

  static async generateLabel(tenantId: string, userId: string, lotId: string, data: any) {
    const cleanUserId = parseUserId(userId);
    const input = GenerateLabelInputSchema.parse(data);

    const lot = await LotTraceabilityService.getLot(tenantId, lotId);
    const speciesId = lot?.metadata?.speciesId ?? null;

    let speciesNameEn: string | null = null;
    let scientificName: string | null = null;
    if (speciesId) {
      const species = await SpeciesRegistryService.getSpecies(tenantId, speciesId);
      speciesNameEn = species.common_name;
      scientificName = species.scientific_name;
    }

    const labelData: Record<string, any> = {
      lotCode: lot.lot_code,
      speciesNameEn,
      speciesNameFr: input.speciesNameFr ?? null,
      scientificName,
      netWeight: lot.quantity,
      unit: lot.unit,
      ...(input.additionalFields ?? {}),
    };

    const rules = await this.getMarketRules(tenantId, input.market);
    const rulesConfigured = rules !== null;

    const missingFields: string[] = [];
    if (rulesConfigured) {
      const requiredFields: string[] =
        typeof rules.required_fields === 'string' ? JSON.parse(rules.required_fields) : rules.required_fields;

      for (const field of requiredFields) {
        if (labelData[field] === undefined || labelData[field] === null || labelData[field] === '') {
          missingFields.push(field);
        }
      }
      if (rules.bilingual_required && !labelData.speciesNameFr && !missingFields.includes('speciesNameFr')) {
        missingFields.push('speciesNameFr');
      }
    }

    const isValid = rulesConfigured && missingFields.length === 0;

    const label = await withTenant(tenantId, async (client: any) => {
      const res = await client.query(
        `INSERT INTO generated_labels (
          tenant_id, lot_id, market, label_data, is_valid, missing_fields, generated_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *`,
        [
          tenantId,
          lotId,
          input.market,
          JSON.stringify(labelData),
          isValid,
          JSON.stringify(missingFields),
          cleanUserId,
        ],
      );
      return res.rows[0];
    });

    return { label, isValid, rulesConfigured, missingFields };
  }

  static async getLabel(tenantId: string, labelId: string) {
    const res = await withTenantQuery(
      `SELECT * FROM generated_labels WHERE tenant_id = $1 AND id = $2`,
      [tenantId, labelId],
      tenantId,
    );
    if (!res || res.length === 0) {
      throw new AppError(`Label ${labelId} not found`, ErrorCode.NOT_FOUND);
    }
    return res[0];
  }

  static async listLabelsForLot(tenantId: string, lotId: string) {
    return withTenantQuery(
      `SELECT * FROM generated_labels WHERE tenant_id = $1 AND lot_id = $2 ORDER BY generated_at DESC`,
      [tenantId, lotId],
      tenantId,
    );
  }
}
