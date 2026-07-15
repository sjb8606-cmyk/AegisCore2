import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { withTenantQuery } from '../../tenancy/src/index';
import { AppError, ErrorCode } from '../../utils/src/index';

export const ClassifyAssetSchema = z.object({
  asset_type: z.string(),
  asset_id: z.string().uuid(),
  metadata: z.record(z.any()).optional(),
});

export const DataGovernanceConfigSchema = z.object({
  enabled: z.boolean(),
  tiers: z.object({
    classificationEngine: z.boolean().default(true),
    piiDetection: z.boolean().default(true),
    policyEnforcement: z.boolean().default(true),
    dataLineage: z.boolean().default(true),
    retentionPolicies: z.boolean().default(true),
    accessLogging: z.boolean().default(true),
    exportTracking: z.boolean().default(true),
    schemaRegistry: z.boolean().default(false),
    manualTagging: z.boolean().default(false),
    autoTagging: z.boolean().default(false),
    deletionPropagation: z.boolean().default(false),
    advancedLineageGraph: z.boolean().default(false),
    auditTrail: z.boolean().default(true),
    policySimulation: z.boolean().default(false),
    realTimeGovernance: z.boolean().default(false),
  }),
  limits: z.object({
    classificationRequestsPerSecond: z.number().default(100),
    lineageGraphDepth: z.number().default(10),
    retentionMaxYears: z.number().default(7),
  }),
});

export type DataGovernanceConfig = z.infer<typeof DataGovernanceConfigSchema>;

let cachedConfig: DataGovernanceConfig | null = null;

export function loadConfig(): DataGovernanceConfig {
  if (cachedConfig) return cachedConfig;
  const configPath = path.resolve(process.cwd(), 'config/data_governance.json');
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8');
      cachedConfig = DataGovernanceConfigSchema.parse(JSON.parse(raw));
      return cachedConfig;
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }

  cachedConfig = DataGovernanceConfigSchema.parse({
    enabled: true,
    tiers: {
      classificationEngine: true,
      piiDetection: true,
      policyEnforcement: true,
      dataLineage: true,
      retentionPolicies: true,
      accessLogging: true,
      exportTracking: true,
      schemaRegistry: false,
      manualTagging: false,
      autoTagging: false,
      deletionPropagation: false,
      advancedLineageGraph: false,
      auditTrail: true,
      policySimulation: false,
      realTimeGovernance: false,
    },
    limits: {
      classificationRequestsPerSecond: 100,
      lineageGraphDepth: 10,
      retentionMaxYears: 7,
    }
  });
  return cachedConfig;
}

export class DataGovernanceService {
  static async classifyDataAsset(tenantId: string, data: any) {
    const config = loadConfig();
    if (!config.enabled) {
      throw new AppError('Data governance engine is globally disabled', ErrorCode.FORBIDDEN);
    }

    if (!config.tiers.classificationEngine) {
      throw new AppError('Classification features are blocked on current tier', ErrorCode.FORBIDDEN);
    }

    const asset = ClassifyAssetSchema.parse(data);

    const sql = `
      INSERT INTO data_assets (tenant_id, asset_type, asset_id, classification, metadata)
      VALUES ($1::uuid, $2, $3::uuid, 'pending', $4::jsonb)
      RETURNING *
    `;
    const params = [tenantId, asset.asset_type, asset.asset_id, JSON.stringify(asset.metadata || {})];

    const rows = await withTenantQuery(sql, params, tenantId);
    if (!rows || rows.length === 0) {
      throw new AppError('Failed to log incoming data asset details', ErrorCode.INTERNAL);
    }

    return rows[0];
  }

  static async recordAccess(tenantId: string, userId: string, assetId: string, action: string) {
    const config = loadConfig();
    if (!config.enabled) {
      throw new AppError('Data governance engine is globally disabled', ErrorCode.FORBIDDEN);
    }

    if (!config.tiers.accessLogging) {
      throw new AppError('Governance access logging is blocked on current tier', ErrorCode.FORBIDDEN);
    }

    const sql = `
      INSERT INTO data_access_logs (tenant_id, user_id, asset_id, action)
      VALUES ($1::uuid, $2::uuid, $3::uuid, $4)
      RETURNING *
    `;
    const params = [tenantId, userId, assetId, action];

    const rows = await withTenantQuery(sql, params, tenantId);
    if (!rows || rows.length === 0) {
      throw new AppError('Failed to record data governance access log', ErrorCode.INTERNAL);
    }

    return rows[0];
  }

  static async fetchAssets(tenantId: string): Promise<any[]> {
    const sql = `
      SELECT id, asset_type, asset_id, classification, sensitivity, metadata, created_at 
      FROM data_assets 
      WHERE tenant_id = $1::uuid 
      ORDER BY created_at DESC 
      LIMIT 100
    `;
    return await withTenantQuery(sql, [tenantId], tenantId);
  }
}
