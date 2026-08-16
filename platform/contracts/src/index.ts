import { parseUserId } from '@platform/utils';
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { withTenantQuery } from '../../tenancy/src/index';
import { getPool } from '../../tenancy/src/rls';
import { AppError, ErrorCode } from '../../utils/src/index';
export { AppError, ErrorCode };

const SIGN_TOKEN_TTL_DAYS = 30;

export const SignatoryInputSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(['signer', 'witness', 'approver']).optional(),
});

export const ContractInputSchema = z.object({
  title: z.string().min(1),
  templateId: z.string().uuid().optional(),
  body: z.string().min(1),
  signatories: z.array(SignatoryInputSchema).min(1),
});

export const ContractsConfigSchema = z.object({
  enabled: z.boolean(),
  tiers: z.object({
    templates: z.boolean().default(true),
    eSignature: z.boolean().default(true),
    multiParty: z.boolean().default(false),
    expiryDates: z.boolean().default(false),
    witnessSignature: z.boolean().default(false),
    smsVerification: z.boolean().default(false),
    auditTrail: z.boolean().default(true),
    encryptedStorage: z.boolean().default(false),
    webhookOnSign: z.boolean().default(false),
    bulkSend: z.boolean().default(false),
  }),
  limits: z.object({
    contractsPerMonth: z.number().default(10),
    templateCount: z.number().default(5),
    signaturesPerContract: z.number().default(2),
    storageRetentionYears: z.number().default(7),
  }),
});

export type ContractsConfig = z.infer<typeof ContractsConfigSchema>;

let cachedConfig: ContractsConfig | null = null;

export function loadConfig(): ContractsConfig {
  if (cachedConfig) return cachedConfig;
  const configPath = path.resolve(process.cwd(), 'config/contracts.json');
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8');
      cachedConfig = ContractsConfigSchema.parse(JSON.parse(raw));
      return cachedConfig;
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }

  cachedConfig = ContractsConfigSchema.parse({
    enabled: true,
    tiers: {
      templates: true,
      eSignature: true,
      multiParty: false,
      expiryDates: false,
      witnessSignature: false,
      smsVerification: false,
      auditTrail: true,
      encryptedStorage: false,
      webhookOnSign: false,
      bulkSend: false,
    },
    limits: {
      contractsPerMonth: 10,
      templateCount: 5,
      signaturesPerContract: 2,
      storageRetentionYears: 7,
    }
  });
  return cachedConfig;
}

export class ContractsService {
  static async createContract(tenantId: string, userId: string, data: any) {
    const config = loadConfig();
    if (!config.enabled) {
      throw new AppError('Contracts platform globally disabled', ErrorCode.FORBIDDEN);
    }

    const input = ContractInputSchema.parse(data);

    // Limit enforcement check
    const currentCount = await this.getTenantUsageThisMonth(tenantId);
    if (currentCount >= config.limits.contractsPerMonth) {
      throw new AppError(`Monthly contract limit reached (${config.limits.contractsPerMonth}/month)`, ErrorCode.FORBIDDEN);
    }

    if (input.signatories.length > config.limits.signaturesPerContract) {
      throw new AppError(`Signatories count exceeds current tier limit (${config.limits.signaturesPerContract})`, ErrorCode.FORBIDDEN);
    }

    const contractSql = `
      INSERT INTO esign_contracts (tenant_id, title, template_id, body, status)
      VALUES ($1::uuid, $2, $3::uuid, $4, 'draft')
      RETURNING *
    `;
    const contractParams = [tenantId, input.title, input.templateId || null, input.body];

    const contractRows = await withTenantQuery(contractSql, contractParams, tenantId);
    if (!contractRows || contractRows.length === 0) {
      throw new AppError('Failed to record contract details', ErrorCode.INTERNAL);
    }

    const contract = contractRows[0];

    // Store signatories
    const signatories: any[] = [];
    for (const sig of input.signatories) {
      const sigSql = `
        INSERT INTO esign_contract_signatories (tenant_id, contract_id, name, email, role)
        VALUES ($1::uuid, $2::uuid, $3, $4, $5)
        RETURNING id, name, email, role, sign_token
      `;
      const sigRows = await withTenantQuery(sigSql, [tenantId, contract.id, sig.name, sig.email, sig.role || 'signer'], tenantId);
      const signatory = sigRows[0];
      signatories.push(signatory);

      // Populate the (deliberately non-RLS) signature_tokens lookup table
      // right here, in the same real tenant context, so it can never drift
      // out of sync with esign_contract_signatories. This is what lets
      // recordSignature() below resolve a bare token to its real tenant
      // before any tenant context exists, without a hardcoded bypass value.
      await getPool().query(
        `INSERT INTO signature_tokens (token, tenant_id, contract_id, signatory_id, expires_at)
         VALUES ($1, $2, $3, $4, NOW() + INTERVAL '${SIGN_TOKEN_TTL_DAYS} days')`,
        [signatory.sign_token, tenantId, contract.id, signatory.id]
      );
    }

    return { contract, signatories };
  }

  static async recordSignature(token: string, signatureData: string, meta: { ip: string; userAgent: string }) {
    // Resolve the token to its real tenant/contract/signatory via the
    // deliberately non-RLS signature_tokens table — this is the one query
    // in this whole flow that legitimately has no tenant context yet, since
    // the caller here is an unauthenticated external signatory who only
    // possesses a secret link, not a login. expires_at is checked here,
    // not just stored: an expired token must be rejected exactly like one
    // that never existed.
    const tokenRows = await getPool().query(
      `SELECT tenant_id, contract_id, signatory_id
       FROM signature_tokens
       WHERE token = $1 AND expires_at > NOW()`,
      [token]
    );
    const tokenRow = tokenRows.rows[0];
    if (!tokenRow) {
      throw new AppError('Invalid or expired signature token', ErrorCode.NOT_FOUND);
    }

    const { tenant_id: tenantId, contract_id: contractId, signatory_id: signatoryId } = tokenRow;

    // Defense in depth: re-verify against the real tenant-scoped tables too
    // (covers e.g. the contract having since been deleted, or the
    // signatory somehow already signed via another path).
    const sql = `
      SELECT s.id, c.status
      FROM esign_contract_signatories s
      JOIN esign_contracts c ON s.contract_id = c.id
      WHERE s.id = $1::uuid AND s.contract_id = $2::uuid AND s.signed_at IS NULL AND c.deleted_at IS NULL
    `;
    const rows = await withTenantQuery(sql, [signatoryId, contractId], tenantId);
    if (!rows || rows.length === 0) {
      throw new AppError('Invalid or already used signature token', ErrorCode.NOT_FOUND);
    }

    const { id } = rows[0];

    // Atomically execute signature update
    const updateSql = `
      UPDATE esign_contract_signatories
      SET signed_at = NOW(), signature_data = $1, ip_address = $2, user_agent = $3
      WHERE id = $4::uuid AND tenant_id = $5::uuid
      RETURNING *
    `;
    await withTenantQuery(updateSql, [signatureData, meta.ip, meta.userAgent, id, tenantId], tenantId);

    // Single-use: invalidate the token immediately now that it's been
    // consumed, rather than waiting for the expiry-based cleanup sweep.
    await getPool().query(`DELETE FROM signature_tokens WHERE token = $1`, [token]);

    // If all signatories have signed, mark contract status as executed
    const checkSql = `
      SELECT COUNT(*)::int as unsigned_count
      FROM esign_contract_signatories
      WHERE contract_id = $1::uuid AND signed_at IS NULL
    `;
    const checkRows = await withTenantQuery(checkSql, [contractId], tenantId);
    const unsignedCount = checkRows[0]?.unsigned_count || 0;

    if (unsignedCount === 0) {
      const execSql = `
        UPDATE esign_contracts
        SET status = 'executed', updated_at = NOW()
        WHERE id = $1::uuid AND tenant_id = $2::uuid
      `;
      await withTenantQuery(execSql, [contractId, tenantId], tenantId);
    }

    return { success: true, contractId };
  }

  /**
   * Delete expired-but-never-used signature tokens so this table doesn't
   * grow indefinitely. Not wired to a scheduler here — no cron/scheduled-
   * job infrastructure exists elsewhere in this codebase yet, so this is
   * exposed for whatever periodic job mechanism gets added, rather than
   * inventing one unprompted.
   */
  static async cleanupExpiredSignatureTokens(): Promise<number> {
    const result = await getPool().query(`DELETE FROM signature_tokens WHERE expires_at <= NOW()`);
    return result.rowCount ?? 0;
  }

  static async fetchContracts(tenantId: string): Promise<any[]> {
    const sql = `
      SELECT id, title, template_id, status, expires_at, created_at 
      FROM esign_contracts 
      WHERE tenant_id = $1::uuid AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT 100
    `;
    return await withTenantQuery(sql, [tenantId], tenantId);
  }

  static async getTenantUsageThisMonth(tenantId: string): Promise<number> {
    const sql = `
      SELECT COUNT(*)::int as count 
      FROM esign_contracts 
      WHERE tenant_id = $1::uuid 
        AND created_at >= date_trunc('month', current_date)
    `;
    const rows = await withTenantQuery(sql, [tenantId], tenantId);
    return rows[0]?.count || 0;
  }
}
