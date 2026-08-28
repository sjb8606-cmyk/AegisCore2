/**
 * platform/fisheries/labelling-engine/src/index.ts
 *
 * Required-field rules per market are TENANT-CONFIGURABLE.
 * species-registry has no French name field — bilingual validation
 * never fabricates speciesNameFr; the caller must supply it.
 */

import { z } from 'zod';
import { withTenant, withTenantQuery } from '@platform/tenancy';
import { LotTraceabilityService } from '@platform/lot-traceability';
import { SpeciesRegistryService } from '@platform/species-registry';
import { AppError, ErrorCode, parseUserId } from '@platform/utils';
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

function parseRequiredFields(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((f): f is string => typeof f === 'string' && f.length > 0);
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter((f): f is string => typeof f === 'string' && f.length > 0)
        : [];
    } catch {
      return [];
    }
  }
  return [];
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
        [
          tenantId,
          input.market,
          JSON.stringify(input.requiredFields),
          input.bilingualRequired,
          cleanUserId,
        ],
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

  static async generateLabel(
    tenantId: string,
    userId: string,
    lotId: string,
    data: any,
  ) {
    const cleanUserId = parseUserId(userId);
    const input = GenerateLabelInputSchema.parse(data);

    const lot = await LotTraceabilityService.getLot(tenantId, lotId);
    const speciesId = lot?.metadata?.speciesId ?? null;

    let speciesNameEn: string | null = null;
    let scientificName: string | null = null;
    if (speciesId) {
      const species = await SpeciesRegistryService.getSpecies(
        tenantId,
        speciesId,
      );
      speciesNameEn = species?.common_name ?? null;
      scientificName = species?.scientific_name ?? null;
    }

    // Never invent French name from registry — only caller-supplied input.
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
      const requiredFields = parseRequiredFields(
        rules.required_fields ?? rules.requiredFields,
      );

      for (const field of requiredFields) {
        if (
          labelData[field] === undefined ||
          labelData[field] === null ||
          labelData[field] === ''
        ) {
          missingFields.push(field);
        }
      }

      const bilingualRequired =
        rules.bilingual_required === true ||
        rules.bilingualRequired === true;

      if (
        bilingualRequired &&
        !labelData.speciesNameFr &&
        !missingFields.includes('speciesNameFr')
      ) {
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
