import { z } from 'zod';
import { loadConfig } from '../../utils/src/index';
import { withTenantQuery } from '../../tenancy/src/index';
import { recordUsage } from '../../metering/src/index';
import { randomUUID } from 'crypto';

const ConfigSchema = z.object({
  enabled: z.boolean(),
  limits: z.object({ maxFileSizeMb: z.number() }),
  storage: z.object({ bucket: z.string(), region: z.string() })
});

export async function requestFileUpload(tenantId: string, filename: string, sizeBytes: number, userId: string) {
  const config = loadConfig('files', ConfigSchema);
  if (!config.enabled) throw new Error('Files feature disabled');

  const maxBytes = config.limits.maxFileSizeMb * 1024 * 1024;
  if (sizeBytes > maxBytes) {
    throw new Error(`File size exceeds limit of ${config.limits.maxFileSizeMb}MB`);
  }

  // 1. Generate Isolated S3 Path: files/[tenant_id]/[file_id]/[filename]
  const fileId = randomUUID();
  const s3Key = `files/${tenantId}/${fileId}/${filename}`;

  // 2. Persist to DB Ledger
  const result = await withTenantQuery(
    `INSERT INTO file_records (id, tenant_id, uploaded_by, name, s3_key, size_bytes) 
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [fileId, tenantId, userId, filename, s3Key, sizeBytes],
    tenantId
  );

  // 3. Meter Usage (Revenue)
  await recordUsage({
    tenantId,
    eventType: 'api_call',
    quantity: 1,
    idempotencyKey: `upload:${fileId}`
  });

  // 4. Return secure presigned upload URL (Simulated for local dev speed)
  const mockPresignedUrl = `https://${config.storage.bucket}.s3.${config.storage.region}.amazonaws.com/${s3Key}?X-Amz-Signature=mock-sig`;

  return {
    fileId: result[0].id,
    uploadUrl: mockPresignedUrl,
    s3Key
  };
}
