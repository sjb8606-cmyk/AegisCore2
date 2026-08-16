/**
 * platform/identity-tier/src/index.ts
 *
 * Progressive trust-tier identity verification — the pattern from the
 * AgoraX spec, generalized for reuse across any AegisCore vertical that
 * needs to gate capabilities behind verification level (marketplaces,
 * fintech onboarding, insurance intake, healthcare patient intake).
 *
 * Tiers (deliberately generic, not AgoraX-specific naming):
 *   1 — unverified / email only
 *   2 — phone verified
 *   3 — basic identity (name, DOB, address)
 *   4 — full identity (government ID + liveness)
 *   5 — attested (highest assurance — e.g. a ZK/cryptographic attestation,
 *       wired to whatever attestation mechanism a given deployment uses)
 *
 * KYC PROVIDER: deliberately NOT wired to a real vendor (Persona, Stripe
 * Identity, etc.) here. That requires real API keys, a signed contract,
 * and per-deployment compliance review — none of which belongs baked
 * into a shared platform core. Instead this exports a
 * TierVerificationProvider interface and a noop default. A real
 * deployment supplies its own provider implementation at the app layer
 * and passes it in — the core never hardcodes a vendor.
 */

import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { enforceQuota } from '@platform/quota-guard';
import { withTenantQuery } from '@platform/tenancy';

export { AppError, ErrorCode };

export const TIER_UNVERIFIED = 1;
export const TIER_PHONE = 2;
export const TIER_BASIC_IDENTITY = 3;
export const TIER_FULL_IDENTITY = 4;
export const TIER_ATTESTED = 5;

const ConfigSchema = z.object({
  enabled: z.boolean(),
  limits: z.object({
    submissionsPerDay: z.number(),
  }),
});

export const VerificationType = z.enum(['phone', 'basic_identity', 'full_identity', 'attestation']);
export type VerificationType = z.infer<typeof VerificationType>;

const TIER_FOR_TYPE: Record<VerificationType, number> = {
  phone: TIER_PHONE,
  basic_identity: TIER_BASIC_IDENTITY,
  full_identity: TIER_FULL_IDENTITY,
  attestation: TIER_ATTESTED,
};

export interface TierVerificationProvider {
  startVerification(input: {
    tenantId: string;
    userId: string;
    verificationType: VerificationType;
    payload: Record<string, unknown>;
  }): Promise<{ providerRef: string; hostedUrl?: string }>;
}

export const noopProvider: TierVerificationProvider = {
  async startVerification() {
    throw new AppError(
      'No identity verification provider configured for this tenant. Wire a real TierVerificationProvider before accepting submissions.',
      ErrorCode.NOT_IMPLEMENTED,
    );
  },
};

export async function submitVerification(
  tenantId: string,
  userId: string,
  data: { verificationType: VerificationType; payload: Record<string, unknown> },
  provider: TierVerificationProvider = noopProvider,
) {
  const parsedType = VerificationType.parse(data.verificationType);

  return runCrudOperation({
    configName: 'identity-tier',
    configSchema: ConfigSchema,
    tenantId,
    actorId: userId,
    checkQuota: async (config: any) => {
      const countRes = await withTenantQuery(
        "SELECT COUNT(*) as count FROM identity_tier_submissions WHERE tenant_id = $1 AND user_id = $2 AND created_at > NOW() - INTERVAL '1 day'",
        [tenantId, userId],
        tenantId,
      );
      enforceQuota(countRes[0]?.count, config.limits.submissionsPerDay, 'Daily identity verification submission limit reached');
    },
    action: async () => {
      const { randomUUID } = await import('crypto');
      const { providerRef, hostedUrl } = await provider.startVerification({
        tenantId,
        userId,
        verificationType: parsedType,
        payload: data.payload,
      });
      const result = await withTenantQuery(
        `INSERT INTO identity_tier_submissions
           (id, tenant_id, user_id, verification_type, tier_requested, provider_ref, payload_json, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
         RETURNING *`,
        [randomUUID(), tenantId, userId, parsedType, TIER_FOR_TYPE[parsedType], providerRef, JSON.stringify(data.payload)],
        tenantId,
      );
      return { ...result[0], hostedUrl };
    },
    auditAction: 'identity.tier_submission_created',
    auditResource: 'identity_tier_submission',
    meterEventType: 'identity_verification_submission',
  });
}

export async function approveSubmission(tenantId: string, actorId: string, submissionId: string) {
  return runCrudOperation({
    configName: 'identity-tier',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    actorType: 'service',
    action: async () => {
      const rows = await withTenantQuery(
        'SELECT * FROM identity_tier_submissions WHERE id = $1 AND tenant_id = $2',
        [submissionId, tenantId],
        tenantId,
      );
      const submission = rows[0];
      if (!submission) throw new AppError('Submission not found', ErrorCode.NOT_FOUND);
      if (submission.status !== 'pending') {
        throw new AppError(`Submission is already ${submission.status}`, ErrorCode.CONFLICT);
      }

      await withTenantQuery(
        "UPDATE identity_tier_submissions SET status = 'approved', resolved_at = NOW() WHERE id = $1 AND tenant_id = $2",
        [submissionId, tenantId],
        tenantId,
      );

      const upserted = await withTenantQuery(
        `INSERT INTO identity_tiers (tenant_id, user_id, current_tier, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (tenant_id, user_id)
         DO UPDATE SET current_tier = GREATEST(identity_tiers.current_tier, EXCLUDED.current_tier), updated_at = NOW()
         RETURNING *`,
        [tenantId, submission.user_id, submission.tier_requested],
        tenantId,
      );
      return upserted[0];
    },
    auditAction: 'identity.tier_advanced',
    auditResource: 'identity_tier_submission',
    auditResourceId: submissionId,
  });
}

export async function rejectSubmission(tenantId: string, actorId: string, submissionId: string, reason: string) {
  return runCrudOperation({
    configName: 'identity-tier',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    actorType: 'service',
    action: async () => {
      const result = await withTenantQuery(
        "UPDATE identity_tier_submissions SET status = 'rejected', resolved_at = NOW(), rejection_reason = $2 WHERE id = $1 AND tenant_id = $3 RETURNING *",
        [submissionId, reason, tenantId],
        tenantId,
      );
      if (!result[0]) throw new AppError('Submission not found', ErrorCode.NOT_FOUND);
      return result[0];
    },
    auditAction: 'identity.tier_rejected',
    auditResource: 'identity_tier_submission',
    auditResourceId: submissionId,
    auditMetadata: { reason },
  });
}

export async function getCurrentTier(tenantId: string, userId: string): Promise<number> {
  const rows = await withTenantQuery(
    'SELECT current_tier FROM identity_tiers WHERE tenant_id = $1 AND user_id = $2',
    [tenantId, userId],
    tenantId,
  );
  return rows[0]?.current_tier ?? TIER_UNVERIFIED;
}

export async function requireTier(tenantId: string, userId: string, minimumTier: number): Promise<void> {
  const current = await getCurrentTier(tenantId, userId);
  if (current < minimumTier) {
    throw new AppError(`This action requires identity tier ${minimumTier}; user is at tier ${current}.`, ErrorCode.FORBIDDEN);
  }
}
