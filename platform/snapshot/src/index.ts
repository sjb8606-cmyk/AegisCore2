import { z } from 'zod';
import { createHash } from 'crypto';
import { loadConfig, AppError, ErrorCode } from '../../utils/src/index';
export { AppError, ErrorCode };
import { withTenantQuery } from '../../tenancy/src/index';
import { recordUsage } from '../../metering/src/index';

const SnapshotConfigSchema = z.object({
  enabled: z.boolean(),
  maxSnapshotsPerEntity: z.number()
});

export async function createSnapshot(tenantId: string, entityType: string, entityId: string, payload: any, actorId: string) {
  const config = loadConfig('document-snapshot', SnapshotConfigSchema);
  if (!config.enabled) throw new AppError('Snapshotting disabled', ErrorCode.FORBIDDEN);

  // 1. Generate Canonical Hash (Consistent Fingerprint)
  const canonicalJson = JSON.stringify(payload, Object.keys(payload).sort());
  const hash = createHash('sha256').update(canonicalJson).digest('hex');

  // 2. Get Next Version Number
  const versions = await withTenantQuery(
    'SELECT MAX(version) as last_v FROM document_snapshots WHERE entity_id = $1',
    [entityId],
    tenantId
  );
  const nextVersion = (versions[0]?.last_v || 0) + 1;

  if (nextVersion > config.maxSnapshotsPerEntity) {
    throw new AppError('Version limit reached', ErrorCode.BAD_REQUEST);
  }

  // 3. Save Immutable Snapshot
  await withTenantQuery(
    `INSERT INTO document_snapshots (tenant_id, entity_type, entity_id, version, payload, content_hash, actor_id) 
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [tenantId, entityType, entityId, nextVersion, JSON.stringify(payload), hash, actorId],
    tenantId
  );

  // 4. Meter usage
  await recordUsage({
    tenantId,
    eventType: 'api_call',
    quantity: 1,
    idempotencyKey: `snap:${entityId}:${nextVersion}`
  });

  return { version: nextVersion, hash };
}
