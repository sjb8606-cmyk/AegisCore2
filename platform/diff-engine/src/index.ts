import { z } from 'zod';
import { createHash } from 'crypto';
import { loadConfig, AppError, ErrorCode } from '../../utils/src/index';
export { AppError, ErrorCode };
import { withTenantQuery } from '../../tenancy/src/index';

const DiffConfigSchema = z.object({
  enabled: z.boolean(),
  limits: z.object({ maxDepth: z.number() })
});

// Helper: Alphabetic sorting for consistent hashing
function canonicalStringify(obj: any): string {
  return JSON.stringify(obj, Object.keys(obj || {}).sort());
}

export async function storeDiff(tenantId: string, input: any) {
  const config = loadConfig('diff-engine', DiffConfigSchema);
  if (!config.enabled) throw new AppError('Diff engine disabled', ErrorCode.FORBIDDEN);

  // 1. Calculate Hashes
  const beforeHash = createHash('sha256').update(canonicalStringify(input.before)).digest('hex');
  const afterHash = createHash('sha256').update(canonicalStringify(input.after)).digest('hex');

  // 2. Simple Field Diff
  const changedFields: string[] = [];
  const diffPayload: any = {};
  
  for (const key of Object.keys(input.after)) {
    if (JSON.stringify(input.before?.[key]) !== JSON.stringify(input.after[key])) {
      changedFields.push(key);
      diffPayload[key] = { from: input.before?.[key], to: input.after[key] };
    }
  }

  // 3. Persist to Audit Trail
  const rows = await withTenantQuery(
    `INSERT INTO diffs (tenant_id, entity_type, entity_id, diff_payload, before_hash, after_hash, changed_fields, actor_id) 
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [tenantId, input.entity_type, input.entity_id, JSON.stringify(diffPayload), beforeHash, afterHash, changedFields, input.actor_id],
    tenantId
  );

  return { id: rows[0].id, changedFields };
}
