import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { withTenantQuery } from '../../tenancy/src/index';
import { AppError, ErrorCode } from '../../utils/src/index';
import { DependencyVulnScannerBot } from '../../aegis-swarm/src/bots/dependency-vuln-scanner';
import { Finding } from '../../bot-runtime/src/types';

export const ScanRequestSchema = z.object({
  scan_type: z.enum(['app','infra','dependency','full']),
  target_assets: z.array(z.string()).optional(),
});

export const PenTestConfigSchema = z.object({
  enabled: z.boolean(),
  tiers: z.object({
    vulnerabilityScanning: z.boolean().default(true),
    dependencyScanning: z.boolean().default(true),
    infrastructureScanning: z.boolean().default(true),
    securityScoring: z.boolean().default(true),
    riskPrioritization: z.boolean().default(true),
    attackSurfaceMapping: z.boolean().default(false),
    misconfigurationDetection: z.boolean().default(false),
    remediationTracking: z.boolean().default(true),
    ciCdSecurityGates: z.boolean().default(false),
    scheduledScans: z.boolean().default(true),
    cveIngestion: z.boolean().default(false),
    penetrationSimulation: z.boolean().default(false),
    advancedThreatEmulation: z.boolean().default(false),
    auditTrail: z.boolean().default(true),
    realTimeSecurityGraph: z.boolean().default(false),
  }),
  limits: z.object({
    scansPerDay: z.number().default(5),
    maxAssetsPerScan: z.number().default(50),
    reportRetentionDays: z.number().default(30),
  }),
});

export type PenTestConfig = z.infer<typeof PenTestConfigSchema>;

let cachedConfig: PenTestConfig | null = null;

export function loadConfig(): PenTestConfig {
  if (cachedConfig) return cachedConfig;
  const configPath = path.resolve(process.cwd(), 'config/pen_test.json');
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8');
      cachedConfig = PenTestConfigSchema.parse(JSON.parse(raw));
      return cachedConfig;
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }

  cachedConfig = PenTestConfigSchema.parse({
    enabled: true,
    tiers: {
      vulnerabilityScanning: true,
      dependencyScanning: true,
      infrastructureScanning: true,
      securityScoring: true,
      riskPrioritization: true,
      attackSurfaceMapping: false,
      misconfigurationDetection: false,
      remediationTracking: true,
      ciCdSecurityGates: false,
      scheduledScans: true,
      cveIngestion: false,
      penetrationSimulation: false,
      advancedThreatEmulation: false,
      auditTrail: true,
      realTimeSecurityGraph: false,
    },
    limits: {
      scansPerDay: 5,
      maxAssetsPerScan: 50,
      reportRetentionDays: 30,
    }
  });
  return cachedConfig;
}

const SEVERITY_TO_FINDING_ROW: Record<Finding['sev'], 'low' | 'medium' | 'high' | 'critical'> = {
  info: 'low',
  warn: 'medium',
  crit: 'high',
  block: 'critical',
};

// Same weighting CrystalBot itself uses for its internal Perfection Index,
// reused here to turn a set of findings into a single 0-100 scan score.
const SEVERITY_SCORE_WEIGHT: Record<Finding['sev'], number> = {
  info: 1,
  warn: 5,
  crit: 15,
  block: 40,
};

export class PenTestService {
  static async runSecurityScan(tenantId: string, data: any) {
    const config = loadConfig();
    if (!config.enabled) {
      throw new AppError('Penetration testing suite is globally disabled', ErrorCode.FORBIDDEN);
    }

    if (!config.tiers.vulnerabilityScanning) {
      throw new AppError('Vulnerability scanning features are blocked on current tier', ErrorCode.FORBIDDEN);
    }

    const request = ScanRequestSchema.parse(data);

    const sql = `
      INSERT INTO security_scans (tenant_id, scan_type, status)
      VALUES ($1::uuid, $2, 'running')
      RETURNING *
    `;
    const rows = await withTenantQuery(sql, [tenantId, request.scan_type], tenantId);
    if (!rows || rows.length === 0) {
      throw new AppError('Failed to initialize security scanning transition state', ErrorCode.INTERNAL);
    }
    const scan = rows[0];

    // Only 'dependency' scanning is real right now (via AegisSwarm's D-06
    // npm-audit bot). 'app'/'infra'/'full' need a real network/application
    // security scanner (e.g. OWASP ZAP, Nessus) that isn't installed yet.
    // Rather than leave those sitting in 'queued' forever with nothing to
    // ever process them, fail the scan honestly so callers know it never ran.
    if (request.scan_type !== 'dependency') {
      await withTenantQuery(
        `UPDATE security_scans SET status = 'failed', completed_at = NOW() WHERE id = $1::uuid`,
        [scan.id],
        tenantId,
      );
      throw new AppError(
        `Scan type '${request.scan_type}' is not yet implemented — only 'dependency' scanning is currently wired up. ` +
        `App/infra scanning requires a dedicated network/application security scanner that isn't installed yet.`,
        ErrorCode.NOT_IMPLEMENTED,
      );
    }

    if (!config.tiers.dependencyScanning) {
      throw new AppError('Dependency scanning blocked on current tier', ErrorCode.FORBIDDEN);
    }

    const targetDir = request.target_assets?.[0] || process.cwd();

    const bot = new DependencyVulnScannerBot({
      version: '1.0',
      proposedBotId: 'D-06',
      role: 'Scans project dependencies for known vulnerabilities using npm audit, converts findings into the standard severity scale, and alerts on critical/high findings without making any changes itself.',
      triggerConditions: ['manual'],
      behaviorDescription: 'Runs npm audit --json against the target directory as part of a pen-test scan request, parses reported vulnerabilities, and records the results as a completed security scan with individual findings.',
      permissionScope: ['exec:npm-audit', 'read:package-manifests'],
      hitlClassification: 'Alert',
      ancestry: { sourceSignals: ['pen-test-integration'], adversarialFingerprintMatch: false },
    });

    let findings: Finding[];
    try {
      const report = await bot.scanDirectory(targetDir);
      findings = report.findings;
    } catch (err) {
      await withTenantQuery(
        `UPDATE security_scans SET status = 'failed', completed_at = NOW() WHERE id = $1::uuid`,
        [scan.id],
        tenantId,
      );
      throw new AppError(`Dependency scan failed: ${(err as Error).message}`, ErrorCode.INTERNAL);
    }

    for (const finding of findings) {
      await withTenantQuery(
        `INSERT INTO security_findings (tenant_id, scan_id, severity, title, description, affected_asset)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)`,
        [
          tenantId,
          scan.id,
          SEVERITY_TO_FINDING_ROW[finding.sev],
          finding.desc.slice(0, 200),
          finding.desc,
          finding.loc,
        ],
        tenantId,
      );
    }

    const scoreDeduction = findings.reduce((sum, f) => sum + SEVERITY_SCORE_WEIGHT[f.sev], 0);
    const score = Math.max(0, 100 - scoreDeduction);

    const completedRows = await withTenantQuery(
      `UPDATE security_scans 
       SET status = 'completed', score = $2, findings_count = $3, completed_at = NOW() 
       WHERE id = $1::uuid 
       RETURNING *`,
      [scan.id, score, findings.length],
      tenantId,
    );

    return completedRows[0];
  }

  static async fetchScans(tenantId: string): Promise<any[]> {
    const sql = `
      SELECT id, scan_type, status, score, findings_count, created_at, completed_at 
      FROM security_scans 
      WHERE tenant_id = $1::uuid 
      ORDER BY created_at DESC 
      LIMIT 100
    `;
    return await withTenantQuery(sql, [tenantId], tenantId);
  }
}
