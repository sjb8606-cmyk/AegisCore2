/**
 * platform/queues/src/dlq-handler.ts
 *
 * Dead-Letter Queue (DLQ) handler.
 *
 * DLQ messages represent permanently failed processing attempts.
 * This handler:
 *   1. Reads from DLQ
 *   2. Logs + emits audit event for every DLQ message
 *   3. Attempts reprocessing if configured
 *   4. Archives to S3 for forensics
 *   5. Alerts on threshold breach
 */

import { SQSClient, Message } from '@aws-sdk/client-sqs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { consumeMessages } from './sqs-client';
import { getLogger } from '@platform/observability';
import { queueMessagesFailed } from '@platform/observability';

const logger = getLogger('queues:dlq');

let _s3: S3Client | null = null;
function getS3Client(): S3Client {
  if (!_s3) {
    _s3 = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
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
  }
  return _s3;
}

const DLQ_ARCHIVE_BUCKET = process.env.S3_DLQ_ARCHIVE_BUCKET || process.env.S3_AUDIT_BUCKET || 'aegis-dlq-archive-local';
const DLQ_ARCHIVE_PREFIX = process.env.S3_DLQ_ARCHIVE_PREFIX || 'dlq-archive/';

export interface DlqHandlerOptions {
  dlqUrl:           string;
  originalQueueUrl: string;
  /** If provided, attempt to reprocess */
  reprocessHandler?: (message: Message) => Promise<void>;
  /** Callback on DLQ message received */
  onDlqMessage?:    (message: Message) => Promise<void>;
}

/**
 * processDlq — drain DLQ messages, log, and optionally reprocess.
 */
export async function processDlq(opts: DlqHandlerOptions): Promise<void> {
  logger.warn({ dlqUrl: opts.dlqUrl }, 'Processing DLQ messages');

  await consumeMessages({
    queueUrl: opts.dlqUrl,
    handler:  async (message) => {
      const receiveCount = message.Attributes?.ApproximateReceiveCount || 'unknown';
      const sentTimestamp = message.Attributes?.SentTimestamp;

      logger.error({
        messageId:    message.MessageId,
        receiveCount,
        sentTimestamp,
        body:         safeParseBody(message.Body),
      }, 'DLQ message received');

      queueMessagesFailed.add(1, { queue: 'dlq', reason: 'max_receives_exceeded' });

      // Custom callback (emit audit event, alert, etc.)
      if (opts.onDlqMessage) {
        await opts.onDlqMessage(message);
      }

      // Attempt reprocessing
      if (opts.reprocessHandler) {
        try {
          logger.info({ messageId: message.MessageId }, 'Attempting DLQ reprocessing');
          await opts.reprocessHandler(message);
          logger.info({ messageId: message.MessageId }, 'DLQ reprocessing succeeded');
        } catch (reprocessErr) {
          logger.error({ reprocessErr, messageId: message.MessageId }, 'DLQ reprocessing also failed — archiving');
          await archiveDlqMessage(message);
        }
      } else {
        await archiveDlqMessage(message);
      }
    },
  });
}

/**
 * Archive DLQ message to S3 for forensic analysis.
 * Falls back to a structured log entry if the S3 write itself fails,
 * so a storage outage can't take down DLQ draining — but the real path
 * is now an actual S3 write, not just a log line.
 */
async function archiveDlqMessage(message: Message): Promise<void> {
  const archivedAt = new Date().toISOString();
  const key = `${DLQ_ARCHIVE_PREFIX}${archivedAt.slice(0, 10)}/${message.MessageId}.json`;

  const record = {
    type:       'DLQ_ARCHIVE',
    messageId:  message.MessageId,
    body:       message.Body,
    attributes: message.Attributes,
    messageAttributes: message.MessageAttributes,
    archivedAt,
  };

  try {
    await getS3Client().send(new PutObjectCommand({
      Bucket:      DLQ_ARCHIVE_BUCKET,
      Key:         key,
      Body:        JSON.stringify(record, null, 2),
      ContentType: 'application/json',
    }));
    logger.info({ messageId: message.MessageId, bucket: DLQ_ARCHIVE_BUCKET, key }, 'DLQ message archived to S3');
  } catch (err) {
    logger.error({ err, ...record }, 'DLQ S3 archive failed — falling back to log-only archive');
  }
}

function safeParseBody(body?: string): unknown {
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}
