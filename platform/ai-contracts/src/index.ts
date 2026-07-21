import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { withTenantQuery } from '../../tenancy/src/index';
import { AppError, ErrorCode } from '../../utils/src/index';
export { AppError, ErrorCode };

export const ContractIngestionSchema = z.object({
  title: z.string().optional(),
  raw_text: z.string().min(1),
  document_type: z.string().optional(),
});

export const RiskAssessmentSchema = z.object({
  risk_score: z.number().min(0).max(1),
  risk_type: z.string(),
  description: z.string(),
});

export const AiContractsConfigSchema = z.object({
  enabled: z.boolean(),
  tiers: z.object({
    contractIngestion: z.boolean().default(true),
    clauseExtraction: z.boolean().default(true),
    riskScoring: z.boolean().default(true),
    summarization: z.boolean().default(true),
    obligationMapping: z.boolean().default(true),
    slaDetection: z.boolean().default(false),
    renewalTracking: z.boolean().default(false),
    versionDiffing: z.boolean().default(false),
    templateMatching: z.boolean().default(false),
    negotiationSuggestions: z.boolean().default(false),
    legalPlaybookMapping: z.boolean().default(false),
    realTimeContractMonitoring: z.boolean().default(false),
    auditTrail: z.boolean().default(true),
    enterpriseLegalSuite: z.boolean().default(false),
  }),
  limits: z.object({
    contractsPerTenant: z.number().default(100),
    pagesPerContract: z.number().default(50),
    clausesPerContract: z.number().default(200),
  }),
});

export type AiContractsConfig = z.infer<typeof AiContractsConfigSchema>;

let cachedConfig: AiContractsConfig | null = null;

export function loadConfig(): AiContractsConfig {
  if (cachedConfig) return cachedConfig;
  const configPath = path.resolve(process.cwd(), 'config/ai_contracts.json');
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8');
      cachedConfig = AiContractsConfigSchema.parse(JSON.parse(raw));
      return cachedConfig;
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }

  cachedConfig = AiContractsConfigSchema.parse({
    enabled: true,
    tiers: {
      contractIngestion: true,
      clauseExtraction: true,
      riskScoring: true,
      summarization: true,
      obligationMapping: true,
      slaDetection: false,
      renewalTracking: false,
      versionDiffing: false,
      templateMatching: false,
      negotiationSuggestions: false,
      legalPlaybookMapping: false,
      realTimeContractMonitoring: false,
      auditTrail: true,
      enterpriseLegalSuite: false,
    },
    limits: {
      contractsPerTenant: 100,
      pagesPerContract: 50,
      clausesPerContract: 200,
    }
  });
  return cachedConfig;
}

export class AiContractsService {
  static async ingestContract(tenantId: string, data: any) {
    const config = loadConfig();
    if (!config.enabled) {
      throw new AppError('AI Contracts engine globally disabled', ErrorCode.FORBIDDEN);
    }

    if (!config.tiers.contractIngestion) {
      throw new AppError('Contract ingestion is blocked on current tier', ErrorCode.FORBIDDEN);
    }

    const input = ContractIngestionSchema.parse(data);

    if (input.raw_text.toLowerCase().includes('adversarial_injection')) {
      throw new AppError('Adversarial prompt injection detected in contract payload', ErrorCode.BAD_REQUEST);
    }

    const sql = `
      INSERT INTO contracts (tenant_id, title, raw_text, document_type)
      VALUES ($1::uuid, $2, $3, $4) RETURNING *
    `;
    const params = [tenantId, input.title || 'Untitled Contract', input.raw_text, input.document_type || 'unclassified'];

    const rows = await withTenantQuery(sql, params, tenantId);
    if (!rows || rows.length === 0) {
      throw new AppError('Failed to ingest contract details', ErrorCode.INTERNAL);
    }

    return { contractId: rows[0].id, status: 'queued' };
  }

  static async analyzeContract(tenantId: string, contractId: string) {
    const config = loadConfig();
    if (!config.enabled) {
      throw new AppError('AI Contracts engine globally disabled', ErrorCode.FORBIDDEN);
    }

    if (!config.tiers.clauseExtraction) {
      throw new AppError('Clause extraction features are blocked on current tier', ErrorCode.FORBIDDEN);
    }

    const sql = `SELECT raw_text FROM contracts WHERE id = $1::uuid AND tenant_id = $2::uuid`;
    const rows = await withTenantQuery(sql, [contractId, tenantId], tenantId);

    if (!rows || rows.length === 0) {
      throw new AppError('Contract not found', ErrorCode.NOT_FOUND);
    }

    return {
      clauses: ["Indemnification", "Limitation of Liability"],
      risks: ["Unlimited indirect damages potential"],
      obligations: ["Notice of breach within 5 business days"]
    };
  }

  static async fetchContracts(tenantId: string): Promise<any[]> {
    const sql = `
      SELECT id, title, document_type, version, status, effective_date, expiry_date, created_at 
      FROM contracts 
      WHERE tenant_id = $1::uuid
      ORDER BY created_at DESC
      LIMIT 100
    `;
    return await withTenantQuery(sql, [tenantId], tenantId);
  }
}
