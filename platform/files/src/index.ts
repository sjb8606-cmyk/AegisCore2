import { z } from 'zod';
import { loadConfig, AppError, ErrorCode } from '../../utils/src/index';
import { withTenantQuery } from '../../tenancy/src/index';
import { recordUsage } from '../../metering/src/index';
import { randomUUID } from 'crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const ConfigSchema = z.object({
  enabled: z.boolean(),
  limits: z.object({ maxFileSizeMb: z.number() }),
  storage: z.object({ bucket: z.string(), region: z.string() })
});

let _s3: S3Client | null = null;
function getS3Client(region: string): S3Client {
  if (!_s3) {
    _s3 = new S3Client({ region });
  }
  return _s3;
}

export async function requestFileUpload(tenantId: string, filename: string, sizeBytes: number, userId: string) {
  const config = loadConfig('files', ConfigSchema);
  if (!config.enabled) throw new AppError('Files feature disabled', ErrorCode.FORBIDDEN);

  const maxBytes = config.limits.maxFileSizeMb * 1024 * 1024;
  if (sizeBytes > maxBytes) {
    throw new AppError(`File size exceeds limit of ${config.limits.maxFileSizeMb}MB`, ErrorCode.BAD_REQUEST);
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

  // 4. Real SigV4 presigned PUT URL. Signing is a local cryptographic
  // operation (AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY from env, same
  // credentials already used elsewhere in the platform) — no network
  // call to AWS is needed to generate it, only to actually use it.
  const s3 = getS3Client(config.storage.region);
  const command = new PutObjectCommand({
    Bucket: config.storage.bucket,
    Key: s3Key,
    ContentLength: sizeBytes,
  });
  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 900 }); // 15 min

  return {
    fileId: result[0].id,
    uploadUrl,
    s3Key
  };
}
