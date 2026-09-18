import { z } from 'zod';
import { loadConfig } from '../../utils/src/index';
import { withTenantQuery } from '../../tenancy/src/index';
import { recordUsage } from '../../metering/src/index';
import { randomUUID } from 'crypto';
import { AppError } from '../../utils/src/index';

const ConfigSchema = z.object({
  enabled: z.boolean(),
  limits: z.object({ maxFileSizeMb: z.number() }),
  storage: z.object({ bucket: z.string(), region: z.string() }),
});

export async function requestFileUpload(
  tenantId: string,
  filename: string,
  sizeBytes: number,
  userId: string
) {
  const config = loadConfig('files', ConfigSchema);
  if (!config.enabled) {
    throw new AppError('Files feature disabled', 'FORBIDDEN');
  }

  const maxBytes = config.limits.maxFileSizeMb * 1024 * 1024;
  if (sizeBytes > maxBytes) {
    throw new AppError(
      `File size exceeds limit of ${config.limits.maxFileSizeMb}MB`,
      'BAD_REQUEST'
    );
  }

  const fileId = randomUUID();
  const s3Key = `files/\( {tenantId}/ \){fileId}/${filename}`;

  const result = await withTenantQuery(
    `INSERT INTO file_records (id, tenant_id, uploaded_by, name, s3_key, size_bytes) 
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [fileId, tenantId, userId, filename, s3Key, sizeBytes],
    tenantId
  );

  await recordUsage({
    tenantId,
    eventType: 'api_call',
    quantity: 1,
    idempotencyKey: `upload:${fileId}`,
  });

  throw new AppError(
    `NOT_IMPLEMENTED: requestFileUpload — real S3 presigned URL generation is not yet implemented. ` +
      `File record ${fileId} was created in the ledger but no upload URL can be issued.`,
    'NOT_IMPLEMENTED'
  );
}
