/**
 * Veridact v1.0 — Zod Runtime Schemas
 */

import { z } from 'zod';

export const ActorSchema = z.object({
  type: z.enum(['system', 'user', 'api_key']),
  id: z.string().min(1).max(256),
  metadata: z
    .object({
      ip: z.string().ip().optional(),
      user_agent: z.string().max(512).optional(),
    })
    .optional(),
});

export const DiffEntrySchema = z.object({
  field: z.string().min(1).max(256),
  before: z.unknown(),
  after: z.unknown(),
});

export const DiffSchema = z.array(DiffEntrySchema);

export const EventTypeSchema = z.enum([
  'new_receipt',
  'rule_change',
  'manual_override',
  'system_update',
  'replay_match',
  'replay_mismatch',
  'hash_mismatch',
]);

export const SeveritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);

export const VerifyContextSchema = z.object({
  source: z.enum(['api', 'internal', 'replay']),
  trigger: z.enum(['manual', 'automated']),
  notes: z.string().max(1024).optional(),
});

export const ContextEnvelopeSchema = z.object({
  idempotency_key: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[\w\-]+$/, 'idempotency_key must be alphanumeric/hyphen/underscore')
    .optional(),
  input: z.record(z.unknown()).refine((v) => Object.keys(v).length > 0, {
    message: 'input must not be empty',
  }),
  rules_version: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[\w.\-]+$/, 'rules_version must be semver-style string'),
  rules_hash: z
    .string()
    .length(64)
    .regex(/^[a-f0-9]+$/, 'rules_hash must be 64-char lowercase hex'),
  context: VerifyContextSchema,
});

export const ReceiptSchema = z.object({
  receipt_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  idempotency_key: z.string().max(128).optional(),
  event_type: z.literal('new_receipt'),
  input: z.record(z.unknown()),
  output: z.record(z.unknown()),
  rules_version: z.string().min(1).max(64),
  rules_hash: z.string().length(64),
  hash: z.string().length(64),
  previous_hash: z.string().length(64),
  timestamp: z.string().datetime(),
  replayable: z.literal(true),
  actor: ActorSchema,
  context: VerifyContextSchema,
});

export const ChangeEntrySchema = z.object({
  change_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  event_type: z.enum(['rule_change', 'manual_override', 'system_update']),
  timestamp: z.string().datetime(),
  actor: ActorSchema,
  action_type: z.string().min(1).max(128),
  previous_state_hash: z.string().length(64),
  new_state_hash: z.string().length(64),
  diff: DiffSchema,
  linked_receipt: z.string().uuid().optional(),
});

export const AlertSchema = z.object({
  alert_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  event_type: EventTypeSchema,
  severity: SeveritySchema,
  message: z.string().min(1).max(2048),
  actor: ActorSchema,
  linked_receipt: z.string().uuid().optional(),
  timestamp: z.string().datetime(),
  human_message: z.string().min(1).max(512),
});

export const PaginationQuerySchema = z.object({
  page: z
    .string()
    .default('1')
    .transform(Number)
    .pipe(z.number().int().min(1).max(10_000)),
  limit: z
    .string()
    .default('20')
    .transform(Number)
    .pipe(z.number().int().min(1).max(100)),
});

export const ChangesQuerySchema = PaginationQuerySchema.extend({
  actor_id: z.string().max(256).optional(),
  event_type: z.enum(['rule_change', 'manual_override', 'system_update']).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export const AlertsQuerySchema = PaginationQuerySchema.extend({
  severity: SeveritySchema.optional(),
  event_type: EventTypeSchema.optional(),
});

export type ZodActor = z.infer<typeof ActorSchema>;
export type ZodContextEnvelope = z.infer<typeof ContextEnvelopeSchema>;
export type ZodReceipt = z.infer<typeof ReceiptSchema>;
export type ZodChangeEntry = z.infer<typeof ChangeEntrySchema>;
export type ZodAlert = z.infer<typeof AlertSchema>;
export type ZodPaginationQuery = z.infer<typeof PaginationQuerySchema>;
export type ZodChangesQuery = z.infer<typeof ChangesQuerySchema>;
export type ZodAlertsQuery = z.infer<typeof AlertsQuerySchema>;
