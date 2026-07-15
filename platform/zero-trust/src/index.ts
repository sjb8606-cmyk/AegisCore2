import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { withTenantQuery } from '../../tenancy/src/index';
import { AppError, ErrorCode } from '../../utils/src/index';

export const TrustEvaluationSchema = z.object({
  user_id: z.string().uuid(),
  device_fingerprint: z.string().optional(),
  context: z.record(z.any()).optional(),
});

export const ZeroTrustConfigSchema = z.object({
  enabled: z.boolean(),
  tiers: z.object({
    deviceTrustScoring: z.boolean().default(true),
    continuousVerification: z.boolean().default(true),
    sessionRevalidation: z.boolean().default(true),
    networkPolicyEngine: z.boolean().default(true),
    microsegmentation: z.boolean().default(false),
    adaptiveAccessControl: z.boolean().default(true),
    privilegedStepUpAuth: z.boolean().default(false),
    trustDecaySystem: z.boolean().default(true),
    contextAwareAccess: z.boolean().default(true),
    apiGatewayIntegration: z.boolean().default(false),
    auditTrail: z.boolean().default(true),
    realTimePolicySimulation: z.boolean().default(false),
    predictiveTrustModeling: z.boolean().default(false),
    fullTrafficInspection: z.boolean().default(false),
  }),
  limits: z.object({
    trustEvaluationsPerSecond: z.number().default(100),
    maxPolicyRulesPerTenant: z.number().default(10),
    sessionRevalidationIntervalSeconds: z.number().default(300),
  }),
});

export type ZeroTrustConfig = z.infer<typeof ZeroTrustConfigSchema>;

let cachedConfig: ZeroTrustConfig | null = null;

export function loadConfig(): ZeroTrustConfig {
  if (cachedConfig) return cachedConfig;
  const configPath = path.resolve(process.cwd(), 'config/zero_trust.json');
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8');
      cachedConfig = ZeroTrustConfigSchema.parse(JSON.parse(raw));
      return cachedConfig;
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  
  cachedConfig = ZeroTrustConfigSchema.parse({
    enabled: true,
    tiers: {
      deviceTrustScoring: true,
      continuousVerification: true,
      sessionRevalidation: true,
      networkPolicyEngine: true,
      microsegmentation: false,
      adaptiveAccessControl: true,
      privilegedStepUpAuth: false,
      trustDecaySystem: true,
      contextAwareAccess: true,
      apiGatewayIntegration: false,
      auditTrail: true,
      realTimePolicySimulation: false,
      predictiveTrustModeling: false,
      fullTrafficInspection: false,
    },
    limits: {
      trustEvaluationsPerSecond: 100,
      maxPolicyRulesPerTenant: 10,
      sessionRevalidationIntervalSeconds: 300,
    }
  });
  return cachedConfig;
}

export class ZeroTrustService {
  static async evaluateTrust(tenantId: string, data: any) {
    const config = loadConfig();
    if (!config.enabled) {
      throw new AppError('Zero-trust engine globally disabled', ErrorCode.FORBIDDEN);
    }

    if (!config.tiers.deviceTrustScoring) {
      throw new AppError('Tier mismatch: deviceTrustScoring is disabled', ErrorCode.FORBIDDEN);
    }

    const evalData = TrustEvaluationSchema.parse(data);
    const deviceFingerprint = evalData.device_fingerprint || 'unknown_device';

    // Look up this device's trust history for this user (if any).
    const existingRows = await withTenantQuery(
      `SELECT trust_score, last_verified FROM device_trust
       WHERE tenant_id = $1::uuid AND user_id = $2::uuid AND device_fingerprint = $3`,
      [tenantId, evalData.user_id, deviceFingerprint],
      tenantId
    );

    const trustScore = computeTrustScore(existingRows[0], evalData, deviceFingerprint);

    const sql = `
      INSERT INTO device_trust (tenant_id, user_id, device_fingerprint, trust_score, last_verified)
      VALUES ($1::uuid, $2::uuid, $3, $4, NOW())
      ON CONFLICT (tenant_id, user_id, device_fingerprint) 
      DO UPDATE SET trust_score = $4, last_verified = NOW()
      RETURNING *
    `;
    const params = [tenantId, evalData.user_id, deviceFingerprint, trustScore];
    const rows = await withTenantQuery(sql, params, tenantId);

    if (!rows || rows.length === 0) {
      throw new AppError('Failed to persist zero-trust evaluation', ErrorCode.INTERNAL);
    }

    const decision = trustScore > 0.7 ? 'allow' : 'step_up';

    if (config.tiers.auditTrail) {
      const eventSql = `
        INSERT INTO trust_events (tenant_id, user_id, event_type, trust_delta, metadata)
        VALUES ($1::uuid, $2::uuid, $3, $4, $5)
      `;
      const eventParams = [
        tenantId,
        evalData.user_id,
        'zt.trust.evaluated',
        trustScore,
        JSON.stringify({ decision, device_fingerprint: evalData.device_fingerprint })
      ];
      await withTenantQuery(eventSql, eventParams, tenantId);
    }

    return { trustScore, decision };
  }

  static async getEvents(tenantId: string): Promise<any[]> {
    const sql = `
      SELECT id, user_id, event_type, trust_delta, metadata, created_at 
      FROM trust_events 
      WHERE tenant_id = $1::uuid 
      ORDER BY created_at DESC 
      LIMIT 100
    `;
    return await withTenantQuery(sql, [tenantId], tenantId);
  }
}

/**
 * Compute a device trust score from real history instead of a hardcoded constant.
 *  - No fingerprint at all            -> heavily distrusted (0.1)
 *  - Never-seen device                -> low starting trust (0.3), must build up over time
 *  - Known device                     -> starts from its last score, decays with time since
 *                                         last verification, and nudges up slightly on each
 *                                         successful re-verification (continuity signal)
 *  - Explicit risk signal in context  -> penalized (e.g. impossible travel, new location)
 */
function computeTrustScore(
  existing: { trust_score: string | number; last_verified: string | Date } | undefined,
  evalData: z.infer<typeof TrustEvaluationSchema>,
  deviceFingerprint: string,
): number {
  if (deviceFingerprint === 'unknown_device') {
    return 0.1;
  }

  if (!existing) {
    return 0.3;
  }

  let score = Number(existing.trust_score) || 0;

  const hoursSinceVerified =
    (Date.now() - new Date(existing.last_verified).getTime()) / (1000 * 60 * 60);
  const decay = Math.min(0.4, hoursSinceVerified / (24 * 30)); // up to 0.4 decay over ~30 days
  score = Math.max(0, score - decay);

  // Continuity bonus for a device that keeps successfully re-verifying
  score = Math.min(0.95, score + 0.05);

  const risk = evalData.context?.riskSignal;
  if (risk === 'new_location' || risk === 'impossible_travel') {
    score = Math.max(0, score - 0.3);
  }

  return Math.round(score * 100) / 100;
}
