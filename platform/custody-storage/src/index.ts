/**
 * platform/custody-storage
 * Blob put/get/delete for Golden Key custody assets.
 * Default driver: memory (tests/dev). Optional: s3.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('custody-storage');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  driver: z.enum(['memory', 's3']).default('memory'),
  bucket: z.string().optional(),
  prefix: z.string().default('custody'),
  region: z.string().default('us-east-1'),
  endpoint: z.string().optional(),
  limits: z
    .object({
      maxBytes: z.number().int().positive().default(52_428_800),
    })
    .default({}),
});

export type CustodyStorageConfig = z.infer<typeof ConfigSchema>;

export interface PutBlobOptions {
  contentType?: string;
  name?: string;
  objectId?: string;
}

export interface PutBlobResult {
  storageKey: string;
  byteSize: number;
  contentSha256: string;
}

export interface BlobObject {
  storageKey: string;
  bytes: Buffer;
  contentType?: string;
  contentSha256: string;
  byteSize: number;
}

export interface StorageDriver {
  put(key: string, bytes: Buffer, contentType?: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

// ── Memory driver ────────────────────────────────────────────

const memoryStore = new Map<string, Buffer>();

export const memoryDriver: StorageDriver = {
  async put(key, bytes) {
    memoryStore.set(key, Buffer.from(bytes));
  },
  async get(key) {
    const hit = memoryStore.get(key);
    return hit ? Buffer.from(hit) : null;
  },
  async delete(key) {
    memoryStore.delete(key);
  },
  async exists(key) {
    return memoryStore.has(key);
  },
};

export function __resetMemoryStore(): void {
  memoryStore.clear();
}

export function __resetDriverCache(): void {
  cachedDriver = null;
}

// ── S3 driver (lazy) ─────────────────────────────────────────

async function createS3Driver(config: CustodyStorageConfig): Promise<StorageDriver> {
  if (!config.bucket) {
    throw new AppError('S3 driver requires config.bucket', ErrorCode.INTERNAL);
  }

  let S3Client: any;
  let PutObjectCommand: any;
  let GetObjectCommand: any;
  let DeleteObjectCommand: any;
  let HeadObjectCommand: any;

  try {
    const mod = await import('@aws-sdk/client-s3' as any);
    S3Client = mod.S3Client;
    PutObjectCommand = mod.PutObjectCommand;
    GetObjectCommand = mod.GetObjectCommand;
    DeleteObjectCommand = mod.DeleteObjectCommand;
    HeadObjectCommand = mod.HeadObjectCommand;
  } catch {
    throw new AppError(
      'S3 driver selected but @aws-sdk/client-s3 is not installed',
      ErrorCode.INTERNAL,
    );
  }

  const client = new S3Client({
    region: config.region,
    ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: true } : {}),
  });
  const bucket = config.bucket;

  return {
    async put(key, bytes, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: bytes,
          ContentType: contentType || 'application/octet-stream',
        }),
      );
    },
    async get(key) {
      try {
        const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        if (!out.Body) return null;
        const chunks: Buffer[] = [];
        for await (const chunk of out.Body as AsyncIterable<Buffer>) {
          chunks.push(Buffer.from(chunk));
        }
        return Buffer.concat(chunks);
      } catch (err: any) {
        if (err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) return null;
        throw err;
      }
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
    async exists(key) {
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return true;
      } catch (err: any) {
        if (err?.name === 'NotFound' || err?.$metadata?.httpStatusCode === 404) return false;
        throw err;
      }
    },
  };
}

let cachedDriver: { id: string; driver: StorageDriver } | null = null;

async function getDriver(config: CustodyStorageConfig): Promise<StorageDriver> {
  const id = `\( {config.driver}: \){config.bucket ?? ''}:${config.endpoint ?? ''}`;
  if (cachedDriver?.id === id) return cachedDriver.driver;
  const driver = config.driver === 's3' ? await createS3Driver(config) : memoryDriver;
  cachedDriver = { id, driver };
  return driver;
}

// ── Key helpers ──────────────────────────────────────────────

function buildStorageKey(tenantId: string, prefix: string, objectId: string): string {
  const cleanPrefix = (prefix || 'custody').replace(/^\/+|\/+$/g, '');
  return cleanPrefix + '/' + tenantId + '/' + objectId;
}

function assertTenantKey(tenantId: string, storageKey: string): void {
  if (!storageKey || storageKey.indexOf('..') !== -1) {
    throw new AppError('Invalid storageKey', ErrorCode.BAD_REQUEST);
  }
  // Must contain /{tenantId}/ as a path segment sequence
  const needle = '/' + tenantId + '/';
  const padded = storageKey.startsWith('/') ? storageKey : '/' + storageKey;
  if (padded.indexOf(needle) === -1) {
    throw new AppError('storageKey is not in tenant scope', ErrorCode.FORBIDDEN);
  }
}

function sha256Hex(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function loadStorageConfig(): Promise<CustodyStorageConfig> {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('custody-storage', ConfigSchema);
}

// ── Public API ───────────────────────────────────────────────

export async function putBlob(
  tenantId: string,
  actorId: string,
  bytes: Buffer | Uint8Array,
  opts: PutBlobOptions = {},
): Promise<PutBlobResult> {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);

  return runCrudOperation({
    configName: 'custody-storage',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    actorType: 'service',
    action: async () => {
      const config = await loadStorageConfig();

      if (buffer.length === 0) {
        throw new AppError('Blob is empty', ErrorCode.BAD_REQUEST);
      }
      if (buffer.length > config.limits.maxBytes) {
        throw new AppError(
          'Blob exceeds max size (' + config.limits.maxBytes + ' bytes)',
          ErrorCode.BAD_REQUEST,
        );
      }

      const objectId = opts.objectId || crypto.randomUUID();
      const storageKey = buildStorageKey(tenantId, config.prefix, objectId);
      const driver = await getDriver(config);
      await driver.put(storageKey, buffer, opts.contentType);

      const contentSha256 = sha256Hex(buffer);
      logger.info({ tenantId, storageKey, byteSize: buffer.length }, 'Blob stored');

      return { storageKey, byteSize: buffer.length, contentSha256 };
    },
    auditAction: 'data.created',
    auditResource: 'custody_blob',
    meterEventType: 'api_call',
  });
}

export async function getBlob(
  tenantId: string,
  actorId: string,
  storageKey: string,
): Promise<BlobObject> {
  return runCrudOperation({
    configName: 'custody-storage',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    actorType: 'service',
    action: async () => {
      assertTenantKey(tenantId, storageKey);
      const config = await loadStorageConfig();
      const driver = await getDriver(config);
      const bytes = await driver.get(storageKey);
      if (!bytes) {
        throw new AppError('Blob not found', ErrorCode.NOT_FOUND);
      }
      return {
        storageKey,
        bytes,
        contentSha256: sha256Hex(bytes),
        byteSize: bytes.length,
      };
    },
    auditAction: 'data.read',
    auditResource: 'custody_blob',
    meterEventType: 'api_call',
  });
}

export async function deleteBlob(
  tenantId: string,
  actorId: string,
  storageKey: string,
): Promise<{ deleted: boolean }> {
  return runCrudOperation({
    configName: 'custody-storage',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    actorType: 'service',
    action: async () => {
      assertTenantKey(tenantId, storageKey);
      const config = await loadStorageConfig();
      const driver = await getDriver(config);
      const existed = await driver.exists(storageKey);
      await driver.delete(storageKey);
      logger.info({ tenantId, storageKey, existed }, 'Blob delete requested');
      return { deleted: existed };
    },
    auditAction: 'data.deleted',
    auditResource: 'custody_blob',
    meterEventType: 'api_call',
  });
}

export async function blobExists(
  tenantId: string,
  actorId: string,
  storageKey: string,
): Promise<boolean> {
  assertTenantKey(tenantId, storageKey);
  const config = await loadStorageConfig();
  const driver = await getDriver(config);
  return driver.exists(storageKey);
}
