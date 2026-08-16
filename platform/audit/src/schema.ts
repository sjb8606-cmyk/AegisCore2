/**
 * platform/audit/src/schema.ts
 *
 * Immutable audit event schema.
 * Once created, audit events must never be modified.
 * Fields prefixed with _ are computed/internal.
 */

import { z } from 'zod';

// ── Audit Event Types ─────────────────────────────────────────

export const AuditAction = z.enum([
  // Auth
  'auth.login',
  'auth.logout',
  'auth.token_refresh',
  'auth.replay_detected',
  'auth.mfa_enrolled',
  // Tenant
  'tenant.created',
  'tenant.updated',
  'tenant.deleted',
  'tenant.suspended',
  // Data
  'data.read',
  'data.created',
  'data.updated',
  'data.deleted',
  'data.exported',
  // Secrets
  'secrets.accessed',
  'secrets.rotated',
  'secrets.revoked',
  // Admin
  'admin.impersonation_started',
  'admin.impersonation_ended',
  'admin.role_granted',
  'admin.role_revoked',
  // AI
  'ai.prompt_submitted',
  'ai.safety_violation',
  'ai.pii_detected',
  // Queue
  'queue.message_processed',
  'queue.dlq_received',
  // Compliance
  'compliance.gdpr_export',
  'compliance.gdpr_deletion',
  'compliance.investigation_opened',
  'compliance.investigation_resolved',
  'compliance.rule_version_created',
  // Swarm / Bots (AegisSwarm)
  'bot.spec_loaded',
  'bot.spec_rejected',
  'bot.decision_recorded',
  'bot.action_blocked',
  'bot.decision_explained',
  'bot.decision_verdict_recorded',
]);

export type AuditAction = z.infer<typeof AuditAction>;

// ── Outcome ───────────────────────────────────────────────────

export const AuditOutcome = z.enum(['success', 'failure', 'partial']);
export type AuditOutcome = z.infer<typeof AuditOutcome>;

// ── Core Event Schema ─────────────────────────────────────────

export const AuditEventSchema = z.object({
  // Identity
  id:          z.string().uuid(),
  tenantId:    z.string().min(1),
  actorId:     z.string().min(1),           // sub from JWT
  actorType:   z.enum(['user', 'service', 'system']),
  actorIp:     z.string().optional(),

  // Event
  action:      AuditAction,
  outcome:     AuditOutcome,
  resource:    z.string().optional(),       // resource type (e.g. 'user', 'secret')
  resourceId:  z.string().optional(),       // resource identifier
  description: z.string().optional(),

  // Metadata
  timestamp:   z.string().datetime(),       // ISO 8601
  traceId:     z.string().optional(),       // OTel trace ID
  sessionId:   z.string().optional(),

  // Context (sanitised, no PII)
  metadata:    z.record(z.unknown()).optional(),

  // Merkle chain (set by shipper)
  _prevHash:   z.string().optional(),       // SHA-256 of previous event
  _hash:       z.string().optional(),       // SHA-256 of this event (set after signing)
  _sequence:   z.number().int().optional(), // monotonically increasing per tenant
});

export type AuditEvent = z.infer<typeof AuditEventSchema>;

// ── Partial input type (before id/hash assigned) ──────────────

export const AuditEventInputSchema = AuditEventSchema.omit({
  id:        true,
  timestamp: true,
  _prevHash: true,
  _hash:     true,
  _sequence: true,
});

export type AuditEventInput = z.infer<typeof AuditEventInputSchema>;

// ── JSON Schema export for external consumers ─────────────────

export function toJsonSchema() {
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title:   'AuditEvent',
    type:    'object',
    properties: {
      id:          { type: 'string', format: 'uuid' },
      tenantId:    { type: 'string', minLength: 1 },
      actorId:     { type: 'string' },
      actorType:   { type: 'string', enum: ['user', 'service', 'system'] },
      actorIp:     { type: 'string' },
      action:      { type: 'string', enum: AuditAction.options },
      outcome:     { type: 'string', enum: AuditOutcome.options },
      resource:    { type: 'string' },
      resourceId:  { type: 'string' },
      description: { type: 'string' },
      timestamp:   { type: 'string', format: 'date-time' },
      traceId:     { type: 'string' },
      sessionId:   { type: 'string' },
      metadata:    { type: 'object' },
      _prevHash:   { type: 'string' },
      _hash:       { type: 'string' },
      _sequence:   { type: 'integer' },
    },
    required: ['id', 'tenantId', 'actorId', 'actorType', 'action', 'outcome', 'timestamp'],
  };
}
