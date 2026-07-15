/**
 * platform/observability/src/metrics.ts
 *
 * Central metrics registry.
 * All application metrics defined here to ensure consistent naming.
 */

import { metrics, Histogram, Counter, UpDownCounter } from '@opentelemetry/api';

const meter = metrics.getMeter(
  process.env.OTEL_SERVICE_NAME || 'platform-core',
  process.env.SERVICE_VERSION   || '1.0.0'
);

// ── HTTP Metrics ──────────────────────────────────────────────

export const httpRequestDuration: Histogram = meter.createHistogram('http_request_duration_ms', {
  description: 'HTTP request duration in milliseconds',
  unit:        'ms',
  boundaries:  [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
});

export const httpRequestsTotal: Counter = meter.createCounter('http_requests_total', {
  description: 'Total number of HTTP requests',
});

export const httpErrorsTotal: Counter = meter.createCounter('http_errors_total', {
  description: 'Total number of HTTP errors',
});

// ── Auth Metrics ──────────────────────────────────────────────

export const authAttemptsTotal: Counter = meter.createCounter('auth_attempts_total', {
  description: 'Total authentication attempts',
});

export const authFailuresTotal: Counter = meter.createCounter('auth_failures_total', {
  description: 'Total authentication failures',
});

export const jtiReplayAttemptsTotal: Counter = meter.createCounter('jti_replay_attempts_total', {
  description: 'Total JWT replay attack attempts detected',
});

// ── Queue Metrics ─────────────────────────────────────────────

export const queueMessagesEnqueued: Counter = meter.createCounter('queue_messages_enqueued_total', {
  description: 'Total messages enqueued',
});

export const queueMessagesProcessed: Counter = meter.createCounter('queue_messages_processed_total', {
  description: 'Total messages processed successfully',
});

export const queueMessagesFailed: Counter = meter.createCounter('queue_messages_failed_total', {
  description: 'Total messages failed (sent to DLQ)',
});

export const queueProcessingDuration: Histogram = meter.createHistogram('queue_message_processing_ms', {
  description: 'Queue message processing duration',
  unit:        'ms',
});

// ── Audit Metrics ─────────────────────────────────────────────

export const auditEventsShipped: Counter = meter.createCounter('audit_events_shipped_total', {
  description: 'Total audit events shipped to S3 WORM',
});

export const auditShipperErrors: Counter = meter.createCounter('audit_shipper_errors_total', {
  description: 'Audit shipper errors',
});

// ── Database Metrics ──────────────────────────────────────────

export const dbQueryDuration: Histogram = meter.createHistogram('db_query_duration_ms', {
  description: 'Database query duration',
  unit:        'ms',
  boundaries:  [1, 5, 10, 25, 50, 100, 250, 500, 1000],
});

export const dbConnectionsActive: UpDownCounter = meter.createUpDownCounter('db_connections_active', {
  description: 'Active database connections',
});

// ── Rate Limit Metrics ────────────────────────────────────────

export const rateLimitHits: Counter = meter.createCounter('rate_limit_hits_total', {
  description: 'Total rate limit violations',
});

// ── AI Safety Metrics ─────────────────────────────────────────

export const aiSafetyViolations: Counter = meter.createCounter('ai_safety_violations_total', {
  description: 'Total AI safety violations detected',
});

export const aiResponseValidations: Counter = meter.createCounter('ai_response_validations_total', {
  description: 'Total AI responses validated',
});

// ── Metering Metrics ──────────────────────────────────────────

export const meteringEventsRecorded: Counter = meter.createCounter('metering_events_recorded_total', {
  description: 'Total usage metering events recorded',
});

export { meter };
