import { z } from 'zod';
import { loadConfig, AppError, ErrorCode } from '../../utils/src/index';
import { withTenantQuery } from '../../tenancy/src/index';
import { verifyChainIntegrity } from '../../audit-log/src/index';

const VerifierConfigSchema = z.object({
  enabled: z.boolean(),
  deepVerification: z.boolean()
});

export async function runIntegrityCheck(tenantId: string) {
  const config = loadConfig('verifier', VerifierConfigSchema);
  if (!config.enabled) throw new AppError('Verifier disabled', ErrorCode.FORBIDDEN);

  // 1. Re-verify the real Postgres-backed audit hash chain for this tenant.
  //    (Previously this re-verified 2 hardcoded fake events every time —
  //    it now checks the actual audit_events table via the working
  //    hash-chain verifier in platform/audit-log.)
  const result = await verifyChainIntegrity(tenantId);

  // 2. Fetch the current chain tail so we record the verdict against the
  //    real last-seen sequence/hash, not a hardcoded stand-in.
  const tailRows = await withTenantQuery(
    `SELECT sequence, event_hash FROM audit_events WHERE tenant_id = $1 ORDER BY sequence DESC LIMIT 1`,
    [tenantId],
    tenantId
  );
  const lastSeq  = tailRows[0]?.sequence ?? 0;
  const lastHash = tailRows[0]?.event_hash ?? '';

  const status = result.verified ? 'valid' : 'corrupted';
  const errors = result.verified
    ? ''
    : `Chain break at sequence ${result.failed_sequence}: expected ${result.expected_hash}, got ${result.actual_hash}`;

  // 3. Record the Verdict
  await withTenantQuery(
    `INSERT INTO integrity_checks (tenant_id, last_verified_seq, last_verified_hash, status, errors) 
     VALUES ($1, $2, $3, $4, $5)`,
    [tenantId, lastSeq, lastHash, status, errors],
    tenantId
  );

  return {
    valid: result.verified,
    checked: result.verified ? result.total_events_checked : 0,
    verdict: result.verified ? 'SECURE' : 'COMPROMISED',
  };
}
