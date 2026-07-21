import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { withTenantQuery } from '../../tenancy/src/index';
import { AppError, ErrorCode } from '../../utils/src/index';
export { AppError, ErrorCode };

export const ThreatEventSchema = z.object({
  event_type: z.string(),
  risk_score: z.number().min(0).max(1).optional(),
  ip_address: z.string().optional(),
  device_fingerprint: z.string().optional(),
  geo_location: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

export const ThreatDetectionConfigSchema = z.object({
  enabled: z.boolean(),
  tiers: z.object({
    anomalyDetection: z.boolean().default(true),
    riskScoring: z.boolean().default(true),
    behaviorBaseline: z.boolean().default(true),
    velocityChecks: z.boolean().default(true),
    geoVelocityDetection: z.boolean().default(false),
    ipReputationTracking: z.boolean().default(false),
    sessionCorrelation: z.boolean().default(true),
    alertingSystem: z.boolean().default(true),
    escalationEngine: z.boolean().default(false),
    automatedLockdown: z.boolean().default(false),
    realTimeSIEMIntegration: z.boolean().default(false),
    advancedThreatHunting: z.boolean().default(false),
    auditTrail: z.boolean().default(true),
    predictiveThreatModeling: z.boolean().default(false),
  }),
  limits: z.object({
    eventsPerSecond: z.number().default(100),
    maxBaselineWindowDays: z.number().default(30),
    alertRetentionDays: z.number().default(90),
  }),
});

export type ThreatDetectionConfig = z.infer<typeof ThreatDetectionConfigSchema>;

let cachedConfig: ThreatDetectionConfig | null = null;

export function loadConfig(): ThreatDetectionConfig {
  if (cachedConfig) return cachedConfig;
  const configPath = path.resolve(process.cwd(), 'config/threat_detection.json');
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8');
      cachedConfig = ThreatDetectionConfigSchema.parse(JSON.parse(raw));
      return cachedConfig;
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }

  cachedConfig = ThreatDetectionConfigSchema.parse({
    enabled: true,
    tiers: {
      anomalyDetection: true,
      riskScoring: true,
      behaviorBaseline: true,
      velocityChecks: true,
      geoVelocityDetection: false,
      ipReputationTracking: false,
      sessionCorrelation: true,
      alertingSystem: true,
      escalationEngine: false,
      automatedLockdown: false,
      realTimeSIEMIntegration: false,
      advancedThreatHunting: false,
      auditTrail: true,
      predictiveThreatModeling: false,
    },
    limits: {
      eventsPerSecond: 100,
      maxBaselineWindowDays: 30,
      alertRetentionDays: 90,
    }
  });
  return cachedConfig;
}

export class ThreatDetectionService {
  static async ingestThreatEvent(tenantId: string, data: any) {
    const config = loadConfig();
    if (!config.enabled) {
      throw new AppError('Threat detection engine globally disabled', ErrorCode.FORBIDDEN);
    }

    if (!config.tiers.anomalyDetection) {
      throw new AppError('Anomaly detection feature not verified on current tier', ErrorCode.FORBIDDEN);
    }

    const event = ThreatEventSchema.parse(data);

    // Never trust a client-supplied risk_score as-is — compute it server-side
    // from real signals in the event history. The client value (if any) is
    // folded in as one weak signal among several, not treated as authoritative.
    const riskScore = await computeRiskScore(tenantId, event, config);

    const sql = `
      INSERT INTO threat_events (tenant_id, event_type, risk_score, ip_address, device_fingerprint, geo_location, metadata)
      VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::jsonb)
      RETURNING *
    `;
    const params = [
      tenantId,
      event.event_type,
      riskScore,
      event.ip_address || null,
      event.device_fingerprint || null,
      event.geo_location || null,
      JSON.stringify(event.metadata || {})
    ];

    const rows = await withTenantQuery(sql, params, tenantId);
    if (!rows || rows.length === 0) {
      throw new AppError('Failed to record threat intelligence signal', ErrorCode.INTERNAL);
    }

    if (config.tiers.alertingSystem && riskScore >= 0.75) {
      const severity = riskScore >= 0.9 ? 'critical' : 'high';
      await withTenantQuery(
        `INSERT INTO threat_alerts (tenant_id, severity, status, description, triggered_by)
         VALUES ($1::uuid, $2, 'open', $3, $4)`,
        [
          tenantId,
          severity,
          `Elevated risk score (${riskScore}) on event type '${event.event_type}'`,
          rows[0].id,
        ],
        tenantId,
      );
    }

    return rows[0];
  }

  static async fetchEvents(tenantId: string): Promise<any[]> {
    const sql = `
      SELECT id, event_type, risk_score, ip_address, device_fingerprint, geo_location, metadata, created_at 
      FROM threat_events 
      WHERE tenant_id = $1::uuid 
      ORDER BY created_at DESC 
      LIMIT 100
    `;
    return await withTenantQuery(sql, [tenantId], tenantId);
  }
}

/**
 * Compute a composite 0-1 risk score from real signals instead of trusting
 * whatever the caller sent:
 *  - Velocity: how many events from this IP/device in the last 5 minutes
 *  - Geo-velocity: did this IP/device just appear from a different location
 *    than its immediately preceding event ("impossible travel" heuristic)
 *  - A small weight for the caller-supplied risk_score, so upstream signals
 *    (e.g. a WAF score) still contribute without being authoritative
 */
async function computeRiskScore(
  tenantId: string,
  event: z.infer<typeof ThreatEventSchema>,
  config: ThreatDetectionConfig,
): Promise<number> {
  let score = 0;

  if (config.tiers.velocityChecks && (event.ip_address || event.device_fingerprint)) {
    const recentCountRows = await withTenantQuery(
      `SELECT COUNT(*)::int AS count FROM threat_events
       WHERE tenant_id = $1::uuid
         AND created_at > NOW() - INTERVAL '5 minutes'
         AND ((ip_address = $2 AND $2 IS NOT NULL) OR (device_fingerprint = $3 AND $3 IS NOT NULL))`,
      [tenantId, event.ip_address || null, event.device_fingerprint || null],
      tenantId,
    );
    const recentCount = recentCountRows[0]?.count ?? 0;
    // 10+ events from the same source in 5 minutes is treated as high-velocity abuse
    score += Math.min(0.5, recentCount / 20);
  }

  if (config.tiers.geoVelocityDetection && event.geo_location && (event.ip_address || event.device_fingerprint)) {
    const lastEventRows = await withTenantQuery(
      `SELECT geo_location, created_at FROM threat_events
       WHERE tenant_id = $1::uuid
         AND ((ip_address = $2 AND $2 IS NOT NULL) OR (device_fingerprint = $3 AND $3 IS NOT NULL))
       ORDER BY created_at DESC LIMIT 1`,
      [tenantId, event.ip_address || null, event.device_fingerprint || null],
      tenantId,
    );
    const last = lastEventRows[0];
    if (last && last.geo_location && last.geo_location !== event.geo_location) {
      const minutesSinceLast = (Date.now() - new Date(last.created_at).getTime()) / 60000;
      if (minutesSinceLast < 60) {
        score += 0.4; // different location in under an hour — likely impossible travel
      }
    }
  }

  // Fold in caller-supplied risk_score as one weak signal, not the whole answer
  if (typeof event.risk_score === 'number') {
    score += event.risk_score * 0.2;
  }

  return Math.min(1, Math.round(score * 100) / 100);
}
