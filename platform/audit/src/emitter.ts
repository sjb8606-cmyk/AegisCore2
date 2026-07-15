/**
 * platform/audit/src/emitter.ts
 *
 * Audit event emitter.
 * - Validates event against schema
 * - Enqueues to SQS (fire-and-forget from business logic perspective)
 * - Falls back to local buffer if SQS unavailable
 * - Never throws (audit failures must not break request flow)
 */

import { randomUUID } from 'crypto';
import { AuditEventInput, AuditEventSchema, AuditEvent } from './schema';
import { getLogger } from '@platform/observability';
import { auditEventsShipped, auditShipperErrors } from '@platform/observability';
import { enqueue } from '../../queues/src/sqs-client';

const logger = getLogger('audit:emitter');

const AUDIT_QUEUE_URL = process.env.SQS_QUEUE_URL || '';
const AUDIT_GROUP_ID  = 'audit-events';

// ── In-memory fallback buffer (for dev / SQS unavailable) ────

const localBuffer: AuditEvent[] = [];
const MAX_BUFFER = 1000;

// ── Emitter ───────────────────────────────────────────────────

/**
 * emit() — create and enqueue an audit event.
 * Must never throw — wrap all errors internally.
 */
export async function emit(input: AuditEventInput): Promise<void> {
  try {
    const event: AuditEvent = {
      ...input,
      id:        randomUUID(),
      timestamp: new Date().toISOString(),
    };

    // Validate schema
    const parsed = AuditEventSchema.parse(event);

    // Attempt SQS enqueue
    try {
      await enqueue({
        queueUrl:       AUDIT_QUEUE_URL,
        body:           JSON.stringify(parsed),
        messageGroupId: `${AUDIT_GROUP_ID}:${parsed.tenantId}`,
        deduplicationId: parsed.id,
      });
      auditEventsShipped.add(1, { tenantId: parsed.tenantId, action: parsed.action });
    } catch (sqsErr) {
      // Fall back to local buffer
      logger.warn({ sqsErr }, 'SQS unavailable — buffering audit event locally');
      auditShipperErrors.add(1, { reason: 'sqs_unavailable' });

      if (localBuffer.length >= MAX_BUFFER) {
        logger.error('Local audit buffer full — dropping oldest event');
        localBuffer.shift();
      }
      localBuffer.push(parsed);
    }
  } catch (err) {
    // Schema validation or other errors — log but never propagate
    logger.error({ err, input }, 'Failed to emit audit event');
    auditShipperErrors.add(1, { reason: 'emit_error' });
  }
}

/**
 * Flush local buffer to SQS (called by background job or on graceful shutdown).
 */
export async function flushLocalBuffer(): Promise<void> {
  if (localBuffer.length === 0) return;

  logger.info({ count: localBuffer.length }, 'Flushing local audit buffer');

  while (localBuffer.length > 0) {
    const event = localBuffer.shift()!;
    try {
      await enqueue({
        queueUrl:        AUDIT_QUEUE_URL,
        body:            JSON.stringify(event),
        messageGroupId:  `${AUDIT_GROUP_ID}:${event.tenantId}`,
        deduplicationId: event.id,
      });
    } catch (err) {
      logger.error({ err, eventId: event.id }, 'Failed to flush buffered audit event');
      localBuffer.unshift(event); // put back
      break;
    }
  }
}

export { localBuffer as _localBuffer }; // exposed for testing
