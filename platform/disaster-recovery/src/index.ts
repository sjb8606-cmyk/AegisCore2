import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { withTenantQuery } from '../../tenancy/src/index';
import { AppError, ErrorCode } from '../../utils/src/index';

export const FailoverRequestSchema = z.object({
  event_type: z.enum(['failover','failback','simulation']),
  region_to: z.string().optional(),
});

export const DisasterRecoveryConfigSchema = z.object({
  enabled: z.boolean(),
  tiers: z.object({
    rtoTracking: z.boolean().default(true),
    rpoTracking: z.boolean().default(true),
    failoverOrchestration: z.boolean().default(true),
    runbookExecution: z.boolean().default(true),
    dependencyGraph: z.boolean().default(true),
    healthQuorumValidation: z.boolean().default(false),
    failbackSupport: z.boolean().default(true),
    drSimulation: z.boolean().default(true),
    readinessScoring: z.boolean().default(false),
    incidentTimeline: z.boolean().default(false),
    chaosDrills: z.boolean().default(false),
    multiRegionAutoFailover: z.boolean().default(false),
    auditTrail: z.boolean().default(true),
    realTimeFailoverGraph: z.boolean().default(false),
    predictiveFailover: z.boolean().default(false),
  }),
  limits: z.object({
    maxFailoverEventsPerDay: z.number().default(3),
    drSimulationFrequencyDays: z.number().default(180),
    maxRunbookSteps: z.number().default(20),
  }),
});

export type DisasterRecoveryConfig = z.infer<typeof DisasterRecoveryConfigSchema>;

let cachedConfig: DisasterRecoveryConfig | null = null;

export function loadConfig(): DisasterRecoveryConfig {
  if (cachedConfig) return cachedConfig;
  const configPath = path.resolve(process.cwd(), 'config/disaster_recovery.json');
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8');
      cachedConfig = DisasterRecoveryConfigSchema.parse(JSON.parse(raw));
      return cachedConfig;
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }

  cachedConfig = DisasterRecoveryConfigSchema.parse({
    enabled: true,
    tiers: {
      rtoTracking: true,
      rpoTracking: true,
      failoverOrchestration: true,
      runbookExecution: true,
      dependencyGraph: true,
      healthQuorumValidation: false,
      failbackSupport: true,
      drSimulation: true,
      readinessScoring: false,
      incidentTimeline: false,
      chaosDrills: false,
      multiRegionAutoFailover: false,
      auditTrail: true,
      realTimeFailoverGraph: false,
      predictiveFailover: false,
    },
    limits: {
      maxFailoverEventsPerDay: 3,
      drSimulationFrequencyDays: 180,
      maxRunbookSteps: 20,
    }
  });
  return cachedConfig;
}

export class DisasterRecoveryService {
  static async triggerFailover(tenantId: string, data: any) {
    const config = loadConfig();
    if (!config.enabled) {
      throw new AppError('Disaster recovery engine globally disabled', ErrorCode.FORBIDDEN);
    }

    if (!config.tiers.failoverOrchestration) {
      throw new AppError('Failover orchestration features are blocked on current tier', ErrorCode.FORBIDDEN);
    }

    const request = FailoverRequestSchema.parse(data);

    const sql = `
      INSERT INTO dr_events (tenant_id, event_type, status, region_to)
      VALUES ($1::uuid, $2, 'triggered', $3)
      RETURNING *
    `;
    const params = [tenantId, request.event_type, request.region_to || 'backup-default'];

    const rows = await withTenantQuery(sql, params, tenantId);
    if (!rows || rows.length === 0) {
      throw new AppError('Failed to initialize failover transition state', ErrorCode.INTERNAL);
    }

    return rows[0];
  }

  static async fetchEvents(tenantId: string): Promise<any[]> {
    const sql = `
      SELECT id, event_type, status, region_from, region_to, started_at, ended_at, metadata 
      FROM dr_events 
      WHERE tenant_id = $1::uuid 
      ORDER BY created_at DESC 
      LIMIT 100
    `;
    return await withTenantQuery(sql, [tenantId], tenantId);
  }
}
