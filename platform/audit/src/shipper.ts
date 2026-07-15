/**
 * platform/audit/src/shipper.ts
 *
 * S3 Object Lock (WORM) audit event shipper.
 *
 * - Consumes audit events from SQS
 * - Links them into Merkle chain
 * - Writes to S3 with Object Lock COMPLIANCE mode
 * - Maintains per-tenant sequence + last hash in DynamoDB/Redis
 * - Objects are immutable once written — cannot be deleted or overwritten
 */

import {
  S3Client,
  PutObjectCommand,
  PutObjectCommandInput,
} from '@aws-sdk/client-s3';
import { AuditEvent } from './schema';
import { linkEvent, ChainedEvent, GENESIS_HASH } from './merkle';
import { getLogger } from '@platform/observability';
import { auditEventsShipped, auditShipperErrors } from '@platform/observability';
import Redis from 'ioredis';

const logger = getLogger('audit:shipper');

// ── S3 Client ─────────────────────────────────────────────────

const s3 = new S3Client({
  region: process.env.S3_AUDIT_REGION || process.env.AWS_REGION || 'us-east-1',
  ...(process.env.AWS_ENDPOINT_URL ? { endpoint: process.env.AWS_ENDPOINT_URL, forcePathStyle: true } : {}),
  ...(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    ? {
        credentials: {
          accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        },
      }
    : {}),
});

const BUCKET = process.env.S3_AUDIT_BUCKET || 'platform-audit-worm';
const PREFIX = process.env.S3_AUDIT_PREFIX || 'audit/';

// ── Sequence store (Redis) ─────────────────────────────────────

const SEQUENCE_PREFIX = (process.env.REDIS_KEY_PREFIX || 'platform:') + 'audit:seq:';
const PREV_HASH_PREFIX = (process.env.REDIS_KEY_PREFIX || 'platform:') + 'audit:hash:';

let _redis: Redis | null = null;
function getRedis(): Redis {
  if (!_redis) {
    _redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
  }
  return _redis;
}

// ── Sequence management ───────────────────────────────────────

async function getNextSequence(tenantId: string): Promise<number> {
  const key = SEQUENCE_PREFIX + tenantId;
  return getRedis().incr(key);
}

async function getPrevHash(tenantId: string): Promise<string> {
  const key  = PREV_HASH_PREFIX + tenantId;
  const hash = await getRedis().get(key);
  return hash || GENESIS_HASH;
}

async function savePrevHash(tenantId: string, hash: string): Promise<void> {
  const key = PREV_HASH_PREFIX + tenantId;
  await getRedis().set(key, hash);
}

// ── Ship to S3 WORM ───────────────────────────────────────────

/**
 * shipEvent — link an event into the chain and write to S3 with Object Lock.
 */
export async function shipEvent(event: AuditEvent): Promise<ChainedEvent> {
  const { tenantId } = event;

  // Build chain link
  const sequence  = await getNextSequence(tenantId);
  const prevHash  = await getPrevHash(tenantId);
  const chained   = linkEvent(event, prevHash, sequence - 1);

  // Construct S3 key: audit/<tenantId>/<date>/<sequence>-<id>.json
  const date   = new Date(event.timestamp);
  const dateStr= date.toISOString().slice(0, 10); // YYYY-MM-DD
  const s3Key  = `${PREFIX}${tenantId}/${dateStr}/${String(sequence).padStart(12, '0')}-${event.id}.json`;

  const body: PutObjectCommandInput = {
    Bucket:             BUCKET,
    Key:                s3Key,
    Body:               JSON.stringify(chained, null, 2),
    ContentType:        'application/json',
    // Object Lock — COMPLIANCE mode: cannot be deleted even by root
    ObjectLockMode:     'COMPLIANCE',
    ObjectLockRetainUntilDate: retainUntil(7), // 7-year retention (SOC2/ISO27001)
    // Metadata for quick queries
    Metadata: {
      'tenant-id':  tenantId,
      'actor-id':   event.actorId,
      'action':     event.action,
      'outcome':    event.outcome,
      'sequence':   String(sequence),
      'event-hash': chained._hash,
    },
    // Server-side encryption
    ServerSideEncryption: 'aws:kms',
    SSEKMSKeyId:          process.env.KMS_KEY_ID,
  };

  await s3.send(new PutObjectCommand(body));

  // Update chain tail
  await savePrevHash(tenantId, chained._hash);

  logger.info({ tenantId, sequence, s3Key, hash: chained._hash }, 'Audit event shipped to S3 WORM');
  auditEventsShipped.add(1, { tenantId, action: event.action });

  return chained;
}

/**
 * shipBatch — ship multiple events in sequence.
 * Events are linked in order — order MATTERS.
 */
export async function shipBatch(events: AuditEvent[]): Promise<ChainedEvent[]> {
  const results: ChainedEvent[] = [];

  for (const event of events) {
    try {
      const chained = await shipEvent(event);
      results.push(chained);
    } catch (err) {
      logger.error({ err, eventId: event.id }, 'Failed to ship audit event');
      auditShipperErrors.add(1, { tenantId: event.tenantId });
      throw err; // Re-throw to trigger DLQ
    }
  }

  return results;
}

// ── Helpers ───────────────────────────────────────────────────

function retainUntil(years: number): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() + years);
  return d;
}

// SWAP FIX: Export getChainHead for Veridact Receipt Engine
export async function getChainHead(tenantId: string): Promise<string> {
  return getPrevHash(tenantId);
}
