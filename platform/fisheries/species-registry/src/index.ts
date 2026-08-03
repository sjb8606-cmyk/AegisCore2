/**
 * platform/fisheries/species-registry/src/index.ts
 */

import { z } from 'zod';
import { withTenantQuery } from '../../../tenancy/src/index';
import { loadConfig, AppError, ErrorCode } from '../../../utils/src/index';
export { AppError, ErrorCode };

const ConfigSchema = z.object({
  enabled: z.boolean(),
  limits: z.object({
    speciesCount: z.number().default(200),
  }),
});

export const CreateSpeciesInputSchema = z.object({
  commonName: z.string().min(1),
  scientificName: z.string().min(1),
  speciesCode: z.string().min(1),
  category: z.enum(['finfish', 'shellfish', 'crustacean', 'other']),
  defaultYieldRatePercent: z.number().min(0).max(100).optional(),
  minLegalSizeCm: z.number().positive().optional(),
});

export const UpdateSpeciesInputSchema = CreateSpeciesInputSchema.partial();

function parseUserId(userId: any): string {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof userId === 'string' && uuidRegex.test(userId)) return userId;
  throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, ErrorCode.BAD_REQUEST);
}

function getConfig() {
  return loadConfig('fisheries-species-registry', ConfigSchema);
}

export class SpeciesRegistryService {
  static async createSpecies(tenantId: string, userId: string, data: any) {
    const config = getConfig();
    if (!config.enabled) {
      throw new AppError('Species registry disabled', ErrorCode.FORBIDDEN);
    }
    parseUserId(userId);
    const input = CreateSpeciesInputSchema.parse(data);

    const countRes = await withTenantQuery(
      'SELECT COUNT(*)::int as count FROM fisheries_species WHERE tenant_id = $1 AND deleted_at IS NULL',
      [tenantId],
      tenantId
    );
    if ((countRes[0]?.count ?? 0) >= (config.limits.speciesCount ?? 200)) {
      throw new AppError('Species registry limit reached', ErrorCode.FORBIDDEN);
    }

    const dupeRes = await withTenantQuery(
      'SELECT id FROM fisheries_species WHERE tenant_id = $1 AND species_code = $2 AND deleted_at IS NULL LIMIT 1',
      [tenantId, input.speciesCode],
      tenantId
    );
    if (dupeRes && dupeRes.length > 0) {
      throw new AppError(`Species code "${input.speciesCode}" already exists for this tenant.`, ErrorCode.CONFLICT);
    }

    const res = await withTenantQuery(
      `INSERT INTO fisheries_species (
        tenant_id, common_name, scientific_name, species_code, category,
        default_yield_rate_percent, min_legal_size_cm, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, true)
      RETURNING *`,
      [
        tenantId,
        input.commonName,
        input.scientificName,
        input.speciesCode,
        input.category,
        input.defaultYieldRatePercent ?? null,
        input.minLegalSizeCm ?? null,
      ],
      tenantId
    );

    return res[0];
  }

  static async getSpecies(tenantId: string, speciesId: string) {
    const res = await withTenantQuery(
      'SELECT * FROM fisheries_species WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL',
      [tenantId, speciesId],
      tenantId
    );
    if (!res || res.length === 0) {
      throw new AppError(`Species ${speciesId} not found`, ErrorCode.NOT_FOUND);
    }
    return res[0];
  }

  static async listSpecies(tenantId: string, options: { activeOnly?: boolean } = {}) {
    const activeOnly = options.activeOnly ?? true;
    const sql = activeOnly
      ? 'SELECT * FROM fisheries_species WHERE tenant_id = $1 AND is_active = true AND deleted_at IS NULL ORDER BY common_name ASC'
      : 'SELECT * FROM fisheries_species WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY common_name ASC';
    return await withTenantQuery(sql, [tenantId], tenantId);
  }

  static async updateSpecies(tenantId: string, speciesId: string, userId: string, data: any) {
    parseUserId(userId);
    const input = UpdateSpeciesInputSchema.parse(data);

    await SpeciesRegistryService.getSpecies(tenantId, speciesId);

    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    const fieldMap: Record<string, string> = {
      commonName: 'common_name',
      scientificName: 'scientific_name',
      speciesCode: 'species_code',
      category: 'category',
      defaultYieldRatePercent: 'default_yield_rate_percent',
      minLegalSizeCm: 'min_legal_size_cm',
    };

    for (const [key, column] of Object.entries(fieldMap)) {
      if (input[key as keyof typeof input] !== undefined) {
        fields.push(`${column} = $${idx}`);
        values.push(input[key as keyof typeof input]);
        idx += 1;
      }
    }

    if (fields.length === 0) {
      throw new AppError('No fields provided to update', ErrorCode.BAD_REQUEST);
    }

    values.push(tenantId, speciesId);
    const res = await withTenantQuery(
      `UPDATE fisheries_species SET ${fields.join(', ')}, updated_at = NOW()
       WHERE tenant_id = $${idx} AND id = $${idx + 1}
       RETURNING *`,
      values,
      tenantId
    );

    return res[0];
  }

  static async deactivateSpecies(tenantId: string, speciesId: string, userId: string) {
    parseUserId(userId);
    await SpeciesRegistryService.getSpecies(tenantId, speciesId);

    const res = await withTenantQuery(
      `UPDATE fisheries_species SET is_active = false, updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [tenantId, speciesId],
      tenantId
    );

    return res[0];
  }
}
