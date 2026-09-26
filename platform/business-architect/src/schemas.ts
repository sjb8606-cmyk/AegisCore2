import { z } from 'zod';

export const BUSINESS_STAGES = [
  'IDEA','CUSTOMER_PROBLEM','RESEARCH','COMPETITION','BUSINESS_MODEL','OPERATIONS',
  'PRICING','COSTS','FINANCIALS','RISKS','FUNDING','PLAN','EXECUTIVE_SUMMARY',
  'FUNDING_PACKAGE','LAUNCH','OPERATE',
] as const;
export type BusinessStage = (typeof BUSINESS_STAGES)[number];

export const CONFIDENCE_TAGS = ['known','evidence_supported','estimated','assumption','unknown'] as const;
export type ConfidenceTag = (typeof CONFIDENCE_TAGS)[number];

export const ProjectStatus = z.enum(['draft','active','paused','completed','archived']);
export type ProjectStatus = z.infer<typeof ProjectStatus>;

export const EvidenceStateSchema = z.object({
  confidenceTag: z.enum(CONFIDENCE_TAGS),
  sourceRefs: z.array(z.string()).default([]),
  rationale: z.string().optional(),
});

export const BusinessProjectSchema = z.object({
  id: z.string().uuid(), tenantId: z.string().uuid(), name: z.string().min(1).max(255),
  status: ProjectStatus, currentStage: z.enum(BUSINESS_STAGES), schemaVersion: z.string().default('0.1'),
  founderProfile: z.record(z.any()).default({}), idea: z.record(z.any()).default({}),
  customerProblem: z.record(z.any()).default({}), market: z.record(z.any()).default({}),
  competition: z.record(z.any()).default({}), businessModel: z.record(z.any()).default({}),
  operations: z.record(z.any()).default({}), pricing: z.record(z.any()).default({}),
  costs: z.record(z.any()).default({}), financialModelRef: z.string().uuid().nullable().default(null),
  researchRefs: z.array(z.string().uuid()).default([]), assumptions: z.array(z.record(z.any())).default([]),
  risks: z.array(z.record(z.any())).default([]), funding: z.record(z.any()).default({}),
  planSections: z.record(z.any()).default({}), deliverables: z.array(z.record(z.any())).default([]),
  decisionLog: z.array(z.record(z.any())).default([]), createdAt: z.string(), updatedAt: z.string(),
});
export type BusinessProject = z.infer<typeof BusinessProjectSchema>;

export const ProjectCreateSchema = z.object({
  name: z.string().min(1).max(255), founderProfile: z.record(z.any()).default({}),
  idea: z.record(z.any()).default({}), status: ProjectStatus.default('draft'),
});
export const ProjectPatchSchema = z.object({
  name: z.string().min(1).max(255).optional(), status: ProjectStatus.optional(),
  founderProfile: z.record(z.any()).optional(), idea: z.record(z.any()).optional(),
  customerProblem: z.record(z.any()).optional(), market: z.record(z.any()).optional(),
  competition: z.record(z.any()).optional(), businessModel: z.record(z.any()).optional(),
  operations: z.record(z.any()).optional(), pricing: z.record(z.any()).optional(),
  costs: z.record(z.any()).optional(), financialModelRef: z.string().uuid().nullable().optional(),
  researchRefs: z.array(z.string().uuid()).optional(), assumptions: z.array(z.record(z.any())).optional(),
  risks: z.array(z.record(z.any())).optional(), funding: z.record(z.any()).optional(),
  planSections: z.record(z.any()).optional(), deliverables: z.array(z.record(z.any())).optional(),
  decisionLog: z.array(z.record(z.any())).optional(),
});

export const CompetitorSchema = z.object({
  id: z.string().uuid(), projectId: z.string().uuid(), tenantId: z.string().uuid(),
  name: z.string().min(1).max(255), website: z.string().url().nullable().optional(),
  description: z.string().default(''), offerings: z.array(z.string()).default([]),
  pricing: z.record(z.any()).default({}), strengths: z.array(z.string()).default([]),
  weaknesses: z.array(z.string()).default([]), differentiation: z.array(z.string()).default([]),
  evidenceRefs: z.array(z.string()).default([]), confidenceTag: z.enum(CONFIDENCE_TAGS).default('unknown'),
});
export type Competitor = z.infer<typeof CompetitorSchema>;

export const BusinessModelSchema = z.object({
  valueProposition: z.string().default(''), customerSegments: z.array(z.string()).default([]),
  channels: z.array(z.string()).default([]), customerRelationships: z.array(z.string()).default([]),
  revenueStreams: z.array(z.string()).default([]), keyResources: z.array(z.string()).default([]),
  keyActivities: z.array(z.string()).default([]), keyPartners: z.array(z.string()).default([]),
  costStructure: z.array(z.string()).default([]), assumptions: z.array(z.record(z.any())).default([]),
  evidenceRefs: z.array(z.string()).default([]),
});
export type BusinessModel = z.infer<typeof BusinessModelSchema>;

export const ArtifactSchema = z.object({
  id: z.string().uuid(), projectId: z.string().uuid(), tenantId: z.string().uuid(),
  type: z.enum(['BUSINESS_PLAN','EXECUTIVE_SUMMARY','FUNDING_PACKAGE','LAUNCH_ROADMAP']),
  version: z.number().int().positive(), status: z.enum(['current','stale','superseded']),
  content: z.record(z.any()), sourceRevision: z.number().int().nonnegative(), createdAt: z.string(),
});
export type BusinessArtifact = z.infer<typeof ArtifactSchema>;
