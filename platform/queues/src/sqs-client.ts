/**
 * platform/queues/src/sqs-client.ts
 *
 * SQS client wrapper implementing the success-only delete pattern:
 *   1. Receive message
 *   2. Process message (business logic)
 *   3. Delete message ONLY if step 2 succeeded
 *   4. On failure: let visibility timeout expire → SQS retries → DLQ
 *
 * This guarantees at-least-once delivery with no message loss.
 */

import {
  SQSClient,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand,
  GetQueueAttributesCommand,
  Message,
} from '@aws-sdk/client-sqs';
import { getLogger } from '@platform/observability';
import {
  queueMessagesEnqueued,
  queueMessagesProcessed,
  queueMessagesFailed,
  queueProcessingDuration,
} from '@platform/observability';
import { withExponentialBackoff } from './retry';

const logger = getLogger('queues:sqs');

// ── Client singleton ──────────────────────────────────────────

let _sqs: SQSClient | null = null;

export function getSqsClient(): SQSClient {
  if (!_sqs) {
    _sqs = new SQSClient({
      region: process.env.AWS_REGION || 'us-east-1',
      ...(process.env.SQS_ENDPOINT || process.env.AWS_ENDPOINT_URL
        ? { endpoint: process.env.SQS_ENDPOINT || process.env.AWS_ENDPOINT_URL }
        : {}),
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
  return _sqs;
}

// ── Enqueue ───────────────────────────────────────────────────

export interface EnqueueOptions {
  queueUrl:        string;
  body:            string;
  messageGroupId?: string;       // FIFO queues
  deduplicationId?: string;      // FIFO queues — idempotency key
  delaySeconds?:   number;       // Standard queues only
  attributes?:     Record<string, string>;
}

export async function enqueue(opts: EnqueueOptions): Promise<string> {
  const client = getSqsClient();

  const msgAttributes: Record<string, { DataType: string; StringValue: string }> = {};
  if (opts.attributes) {
    for (const [k, v] of Object.entries(opts.attributes)) {
      msgAttributes[k] = { DataType: 'String', StringValue: v };
    }
  }

  const cmd = new SendMessageCommand({
    QueueUrl:               opts.queueUrl,
    MessageBody:            opts.body,
    MessageGroupId:         opts.messageGroupId,
    MessageDeduplicationId: opts.deduplicationId,
    DelaySeconds:           opts.delaySeconds,
    MessageAttributes:      Object.keys(msgAttributes).length ? msgAttributes : undefined,
  });

  const result = await withExponentialBackoff(() => client.send(cmd));
  queueMessagesEnqueued.add(1, { queue: extractQueueName(opts.queueUrl) });

  logger.debug({ messageId: result.MessageId, queue: opts.queueUrl }, 'Message enqueued');
  return result.MessageId!;
}

// ── Consumer ──────────────────────────────────────────────────

export type MessageHandler = (message: Message) => Promise<void>;

export interface ConsumerOptions {
  queueUrl:         string;
  handler:          MessageHandler;
  maxMessages?:     number;   // 1–10
  waitTimeSeconds?: number;   // long-polling
  visibilityTimeout?: number; // seconds
  concurrency?:     number;   // parallel handlers
}

/**
 * consumeMessages — poll SQS and process messages with success-only delete.
 * Returns when queue is empty or max poll reached.
 */
export async function consumeMessages(opts: ConsumerOptions): Promise<void> {
  const client = getSqsClient();
  const {
    queueUrl,
    handler,
    maxMessages     = 10,
    waitTimeSeconds = parseInt(process.env.SQS_WAIT_TIME_SECONDS || '20', 10),
    visibilityTimeout = parseInt(process.env.SQS_VISIBILITY_TIMEOUT || '30', 10),
  } = opts;

  const receiveCmd = new ReceiveMessageCommand({
    QueueUrl:            queueUrl,
    MaxNumberOfMessages: maxMessages,
    WaitTimeSeconds:     waitTimeSeconds,
    VisibilityTimeout:   visibilityTimeout,
    MessageAttributeNames: ['All'],
    AttributeNames:        ['All'],
  });

  const response = await client.send(receiveCmd);
  const messages = response.Messages || [];

  if (messages.length === 0) {
    logger.debug({ queue: queueUrl }, 'No messages received');
    return;
  }

  logger.info({ count: messages.length, queue: queueUrl }, 'Messages received');

  // Process each message (sequential for FIFO, could parallelise for standard)
  await Promise.all(messages.map((msg) => processMessage(client, queueUrl, msg, handler, visibilityTimeout)));
}

// ── Internal: process single message ─────────────────────────

async function processMessage(
  client:    SQSClient,
  queueUrl:  string,
  message:   Message,
  handler:   MessageHandler,
  visibilityTimeout: number,
): Promise<void> {
  const startMs = Date.now();
  const queueName = extractQueueName(queueUrl);

  logger.debug({ messageId: message.MessageId }, 'Processing message');

  try {
    await handler(message);

    // ✅ SUCCESS: Delete message from queue
    await client.send(new DeleteMessageCommand({
      QueueUrl:      queueUrl,
      ReceiptHandle: message.ReceiptHandle!,
    }));

    const durationMs = Date.now() - startMs;
    queueMessagesProcessed.add(1, { queue: queueName });
    queueProcessingDuration.record(durationMs, { queue: queueName });

    logger.info({ messageId: message.MessageId, durationMs }, 'Message processed and deleted');
  } catch (err) {
    // ❌ FAILURE: Do NOT delete — let visibility timeout expire → retry → DLQ
    queueMessagesFailed.add(1, { queue: queueName });

    logger.error({
      err,
      messageId:        message.MessageId,
      receiveCount:     message.Attributes?.ApproximateReceiveCount,
    }, 'Message processing failed — leaving for retry/DLQ');
    // Do not re-throw; the visibility timeout will handle retry
  }
}

// ── Helpers ───────────────────────────────────────────────────

function extractQueueName(queueUrl: string): string {
  return queueUrl.split('/').pop() || queueUrl;
}

export async function getQueueDepth(queueUrl: string): Promise<number> {
  const client = getSqsClient();
  const result = await client.send(new GetQueueAttributesCommand({
    QueueUrl:       queueUrl,
    AttributeNames: ['ApproximateNumberOfMessages'],
  }));
  return parseInt(result.Attributes?.ApproximateNumberOfMessages || '0', 10);
}
