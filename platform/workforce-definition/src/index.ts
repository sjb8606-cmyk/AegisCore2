import { z } from 'zod';

const NonEmptyString = z.string().trim().min(1);

export const WorkforceLifecycleStatusSchema = z.enum([
  'DRAFT',
  'VALIDATED',
  'REGISTERED',
  'APPROVED',
  'ACTIVE',
  'SUSPENDED',
  'DEPRECATED',
  'RETIRED'
]);

export const WorkforceVerificationStatusSchema = z.enum([
  'UNVERIFIED',
  'VALIDATED',
  'VERIFIED'
]);

const IdentitySchema = z.object({
  name: NonEmptyString,
  title: NonEmptyString.optional(),
  persona_ref: NonEmptyString.optional(),
  worldview: NonEmptyString.optional(),
  voice: NonEmptyString.optional(),
  humanity_mode: NonEmptyString.optional(),
  boundaries: z.array(NonEmptyString).default([]),
  identity_invariants: z.array(NonEmptyString).default([])
}).strict();

const OperationalCapabilitiesSchema = z.object({
  skills: z.array(NonEmptyString).default([]),
  tools: z.array(NonEmptyString).default([]),
  workflows: z.array(NonEmptyString).default([]),
  services: z.array(NonEmptyString).default([])
}).strict();

const ModesSchema = z.object({
  chat: z.object({
    enabled: z.boolean()
  }).strict(),
  bot: z.object({
    enabled: z.boolean(),
    trigger_conditions: z.array(NonEmptyString).default([])
  }).strict(),
  agent: z.object({
    enabled: z.boolean(),
    allowed_tools: z.array(NonEmptyString).default([])
  }).strict()
}).strict();

const AuthoritySchema = z.object({
  permission_scope: z.array(NonEmptyString).default([]),
  hitl_classification: NonEmptyString,
  hard_stops: z.array(NonEmptyString).default([]),
  tenant_scope: z.array(NonEmptyString).default([])
}).strict();

const KnowledgeSchema = z.object({
  domains: z.array(NonEmptyString).default([]),
  sources: z.array(NonEmptyString).default([]),
  retrieval_rules: z.array(NonEmptyString).default([]),
  boundaries: z.array(NonEmptyString).default([])
}).strict();

const MemorySchema = z.object({
  conversational: z.boolean(),
  task: z.boolean(),
  workforce: z.boolean(),
  organizational: z.boolean(),
  evidence: z.boolean()
}).strict();

const LegacyRefsSchema = z.object({
  persona_id: z.string().optional(),
  bot_id: z.string().optional(),
  employee_id: z.string().optional(),
  agent_id: z.string().optional()
}).strict();

const VerificationSchema = z.object({
  status: WorkforceVerificationStatusSchema,
  evidence_ref: z.string().optional()
}).strict();

export const WorkforceDefinitionSchema = z.object({
  schema_version: z.literal('1.0'),
  workforce_id: NonEmptyString.max(255),
  version: NonEmptyString,
  identity: IdentitySchema,
  domain_capabilities: z.array(NonEmptyString).default([]),
  operational_capabilities: OperationalCapabilitiesSchema,
  modes: ModesSchema,
  authority: AuthoritySchema,
  knowledge: KnowledgeSchema,
  memory: MemorySchema,
  lifecycle: z.object({
    status: WorkforceLifecycleStatusSchema
  }).strict(),
  legacy_refs: LegacyRefsSchema,
  verification: VerificationSchema
}).strict();

export type WorkforceDefinition = z.infer<typeof WorkforceDefinitionSchema>;
