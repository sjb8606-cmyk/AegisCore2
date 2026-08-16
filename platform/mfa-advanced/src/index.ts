import { parseUserId } from '@platform/utils';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { z } from 'zod';
import { withTenantQuery } from '../../tenancy/src/index';
import { AppError, ErrorCode } from '../../utils/src/index';
export { AppError, ErrorCode };
import { encryptField, decryptField } from '../../security/src/kms';

export const TotpEnrollSchema = z.object({
  secret: z.string(),
  label: z.string().optional(),
});

export const ChallengeVerifySchema = z.object({
  challenge_id: z.string().uuid(),
  response: z.string(),
});

export const MfaAdvancedConfigSchema = z.object({
  enabled: z.boolean(),
  tiers: z.object({
    totp: z.boolean().default(true),
    recoveryCodes: z.boolean().default(true),
    webAuthn: z.boolean().default(true),
    hardwareKeys: z.boolean().default(false),
    deviceTrustRegistry: z.boolean().default(true),
    stepUpAuth: z.boolean().default(false),
    sessionRevalidation: z.boolean().default(false),
    adaptiveMFA: z.boolean().default(false),
    riskScoring: z.boolean().default(false),
    biometricStubs: z.boolean().default(false),
    auditTrail: z.boolean().default(true),
    advancedFraudDetection: z.boolean().default(false),
  }),
  limits: z.object({
    maxDevicesPerUser: z.number().default(5),
    recoveryCodesCount: z.number().default(12),
    mfaAttemptsPerMinute: z.number().default(10),
  }),
});

export type MfaAdvancedConfig = z.infer<typeof MfaAdvancedConfigSchema>;

let cachedConfig: MfaAdvancedConfig | null = null;

export function loadConfig(): MfaAdvancedConfig {
  if (cachedConfig) return cachedConfig;
  const configPath = path.resolve(process.cwd(), 'config/mfa_advanced.json');
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8');
      cachedConfig = MfaAdvancedConfigSchema.parse(JSON.parse(raw));
      return cachedConfig;
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }

  cachedConfig = MfaAdvancedConfigSchema.parse({
    enabled: true,
    tiers: {
      totp: true,
      recoveryCodes: true,
      webAuthn: true,
      hardwareKeys: false,
      deviceTrustRegistry: true,
      stepUpAuth: false,
      sessionRevalidation: false,
      adaptiveMFA: false,
      riskScoring: false,
      biometricStubs: false,
      auditTrail: true,
      advancedFraudDetection: false,
    },
    limits: {
      maxDevicesPerUser: 5,
      recoveryCodesCount: 12,
      mfaAttemptsPerMinute: 10,
    }
  });
  return cachedConfig;
}

function hashRecoveryCode(code: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(code, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyRecoveryCodeHash(code: string, storedHash: string): boolean {
  const [salt, derivedHex] = storedHash.split(':');
  if (!salt || !derivedHex) return false;
  const candidate = crypto.scryptSync(code, salt, 64);
  const stored = Buffer.from(derivedHex, 'hex');
  if (candidate.length !== stored.length) return false;
  return crypto.timingSafeEqual(candidate, stored);
}

export class MfaAdvancedService {
  static async enrollTotp(tenantId: string, userId: string, data: any) {
    const config = loadConfig();
    if (!config.enabled) {
      throw new AppError('MFA security features are globally disabled', ErrorCode.FORBIDDEN);
    }

    if (!config.tiers.totp) {
      throw new AppError('TOTP authentication features are blocked on current tier', ErrorCode.FORBIDDEN);
    }

    const input = TotpEnrollSchema.parse(data);
    const encryptedSecret = await encryptField(input.secret);
    const cleanUserId = parseUserId(userId);

    const sql = `
      INSERT INTO mfa_methods (tenant_id, user_id, type, secret)
      VALUES ($1::uuid, $2::uuid, 'totp', $3)
      RETURNING id, user_id, type, created_at
    `;
    const params = [tenantId, cleanUserId, encryptedSecret];

    const rows = await withTenantQuery(sql, params, tenantId);
    if (!rows || rows.length === 0) {
      throw new AppError('Failed to enroll TOTP credentials', ErrorCode.INTERNAL);
    }

    return rows[0];
  }

  static async verifyChallenge(tenantId: string, userId: string, data: any) {
    const input = ChallengeVerifySchema.parse(data);
    const cleanUserId = parseUserId(userId);

    const sql = `
      SELECT id, status, expires_at 
      FROM mfa_challenges 
      WHERE id = $1::uuid AND user_id = $2::uuid AND expires_at > NOW()
    `;
    const params = [input.challenge_id, cleanUserId];

    const rows = await withTenantQuery(sql, params, tenantId);
    if (!rows || rows.length === 0) {
      throw new AppError('MFA challenge not found, expired, or already used', ErrorCode.UNAUTHORIZED);
    }
    if (rows[0].status === 'verified') {
      throw new AppError('MFA challenge has already been verified', ErrorCode.CONFLICT);
    }

    const updateSql = `UPDATE mfa_challenges SET status = 'verified' WHERE id = $1::uuid`;
    await withTenantQuery(updateSql, [input.challenge_id], tenantId);

    return { success: true };
  }

  static async generateRecoveryCodes(tenantId: string, userId: string) {
    const config = loadConfig();
    if (!config.enabled) {
      throw new AppError('MFA security features are globally disabled', ErrorCode.FORBIDDEN);
    }

    if (!config.tiers.recoveryCodes) {
      throw new AppError('MFA backup recovery codes blocked on current tier', ErrorCode.FORBIDDEN);
    }

    const codes = Array.from({ length: config.limits.recoveryCodesCount }, () =>
      crypto.randomBytes(6).toString('hex').toUpperCase()
    );
    const cleanUserId = parseUserId(userId);

    for (const code of codes) {
      const codeHash = hashRecoveryCode(code);
      const sql = `
        INSERT INTO mfa_recovery_codes (tenant_id, user_id, code_hash)
        VALUES ($1::uuid, $2::uuid, $3)
      `;
      await withTenantQuery(sql, [tenantId, cleanUserId, codeHash], tenantId);
    }

    return { codes };
  }

  static async fetchMethods(tenantId: string, userId: string): Promise<any[]> {
    const cleanUserId = parseUserId(userId);
    const sql = `
      SELECT id, type, is_active, created_at 
      FROM mfa_methods 
      WHERE tenant_id = $1::uuid AND user_id = $2::uuid
      ORDER BY created_at DESC
    `;
    return await withTenantQuery(sql, [tenantId, cleanUserId], tenantId);
  }
}
