/**
 * platform/job-work-order
 *
 * Unit of work: create → assign → schedule → status transition → close.
 * Status transitions validated against config jobType workflow (lightweight;
 * full FSM can delegate to @platform/workflow-state later).
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('job-work-order');

const DefaultStatuses = [
  'draft',
  'open',
  'assigned',
  'in_progress',
  'completed',
  'cancelled',
] as const;

export type JobStatus = (typeof DefaultStatuses)[number] | string;

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  jobTypes: z
    .array(
      z.object({
        type: z.string(),
        requiredFields: z.array(z.string()).default([]),
        allowedTransitions: z
          .array(z.object({ from: z.string(), to: z.string() }))
          .default([]),
      }),
    )
    .default([
      {
        type: 'service',
        requiredFields: ['description'],
        allowedTransitions: [
          { from: 'draft', to: 'open' },
          { from: 'open', to: 'assigned' },
          { from: 'assigned', to: 'in_progress' },
          { from: 'in_progress', to: 'completed' },
          { from: 'open', to: 'cancelled' },
          { from: 'assigned', to: 'cancelled' },
          { from: 'draft', to: 'cancelled' },
        ],
      },
    ]),
  defaultStatus: z.string().default('draft'),
});

export interface Job {
  id: string;
  tenantId: string;
  type: string;
  status: JobStatus;
  entityRef: string | null;
  description: string;
  scheduledAt: string | null;
  assignedTo: string | null;
  details: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

const jobs = new Map<string, Job>();

export function __resetJobWorkOrderStore(): void {
  jobs.clear();
}

async function loadCfg() {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('job-work-order', ConfigSchema);
}

function typeConfig(
  config: z.infer<typeof ConfigSchema>,
  type: string,
) {
  return config.jobTypes.find((t) => t.type === type);
}

export async function createJob(
  tenantId: string,
  actorId: string,
  input: {
    type: string;
    description: string;
    entityRef?: string;
    scheduledAt?: string;
    assignedTo?: string;
    details?: Record<string, unknown>;
  },
): Promise<Job> {
  return runCrudOperation({
    configName: 'job-work-order',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      const tc = typeConfig(config, input.type);
      if (!tc) {
        throw new AppError('Unknown job type: ' + input.type, ErrorCode.BAD_REQUEST);
      }
      if (!input.description?.trim()) {
        throw new AppError('description is required', ErrorCode.BAD_REQUEST);
      }
      for (const f of tc.requiredFields) {
        if (f === 'description') continue;
        const bag = { ...input.details, entityRef: input.entityRef };
        if ((bag as any)[f] === undefined || (bag as any)[f] === '') {
          throw new AppError('missing required field: ' + f, ErrorCode.BAD_REQUEST);
        }
      }
      const now = new Date().toISOString();
      const job: Job = {
        id: crypto.randomUUID(),
        tenantId,
        type: input.type,
        status: config.defaultStatus,
        entityRef: input.entityRef || null,
        description: input.description.trim(),
        scheduledAt: input.scheduledAt || null,
        assignedTo: input.assignedTo || null,
        details: input.details || {},
        createdBy: actorId,
        createdAt: now,
        updatedAt: now,
      };
      jobs.set(job.id, job);
      logger.info({ jobId: job.id, type: job.type }, 'Job created');
      return job;
    },
    auditAction: 'data.created',
    auditResource: 'job',
    meterEventType: 'api_call',
  });
}

export async function assignJob(
  tenantId: string,
  actorId: string,
  jobId: string,
  assignedTo: string,
): Promise<Job> {
  return runCrudOperation({
    configName: 'job-work-order',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const job = jobs.get(jobId);
      if (!job || job.tenantId !== tenantId) {
        throw new AppError('Job not found', ErrorCode.NOT_FOUND);
      }
      if (!assignedTo?.trim()) {
        throw new AppError('assignedTo required', ErrorCode.BAD_REQUEST);
      }
      job.assignedTo = assignedTo.trim();
      // auto-advance open → assigned when applicable
      if (job.status === 'open' || job.status === 'draft') {
        const config = await loadCfg();
        const tc = typeConfig(config, job.type);
        const next = 'assigned';
        const ok = tc?.allowedTransitions.some(
          (t) => t.from === job.status && t.to === next,
        );
        if (ok) job.status = next;
      }
      job.updatedAt = new Date().toISOString();
      jobs.set(jobId, job);
      return job;
    },
    auditAction: 'data.updated',
    auditResource: 'job',
    meterEventType: 'api_call',
  });
}

export async function scheduleJob(
  tenantId: string,
  actorId: string,
  jobId: string,
  scheduledAt: string,
): Promise<Job> {
  return runCrudOperation({
    configName: 'job-work-order',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const job = jobs.get(jobId);
      if (!job || job.tenantId !== tenantId) {
        throw new AppError('Job not found', ErrorCode.NOT_FOUND);
      }
      if (!scheduledAt || Number.isNaN(Date.parse(scheduledAt))) {
        throw new AppError('invalid scheduledAt', ErrorCode.BAD_REQUEST);
      }
      job.scheduledAt = scheduledAt;
      job.updatedAt = new Date().toISOString();
      jobs.set(jobId, job);
      return job;
    },
    auditAction: 'data.updated',
    auditResource: 'job',
    meterEventType: 'api_call',
  });
}

export async function transitionJob(
  tenantId: string,
  actorId: string,
  jobId: string,
  newStatus: string,
): Promise<Job> {
  return runCrudOperation({
    configName: 'job-work-order',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      const job = jobs.get(jobId);
      if (!job || job.tenantId !== tenantId) {
        throw new AppError('Job not found', ErrorCode.NOT_FOUND);
      }
      const tc = typeConfig(config, job.type);
      if (!tc) {
        throw new AppError('Unknown job type', ErrorCode.BAD_REQUEST);
      }
      const allowed = tc.allowedTransitions.some(
        (t) => t.from === job.status && t.to === newStatus,
      );
      if (!allowed) {
        throw new AppError(
          'Transition not allowed: ' + job.status + ' → ' + newStatus,
          ErrorCode.FORBIDDEN,
        );
      }
      job.status = newStatus;
      job.updatedAt = new Date().toISOString();
      jobs.set(jobId, job);
      logger.info({ jobId, status: newStatus }, 'Job transitioned');
      return job;
    },
    auditAction: 'data.updated',
    auditResource: 'job',
    meterEventType: 'api_call',
  });
}

export async function getJob(
  tenantId: string,
  jobId: string,
): Promise<Job | null> {
  const j = jobs.get(jobId);
  if (!j || j.tenantId !== tenantId) return null;
  return j;
}

export async function listJobs(
  tenantId: string,
  filter?: { status?: string; assignedTo?: string; type?: string },
): Promise<Job[]> {
  return [...jobs.values()].filter((j) => {
    if (j.tenantId !== tenantId) return false;
    if (filter?.status && j.status !== filter.status) return false;
    if (filter?.assignedTo && j.assignedTo !== filter.assignedTo) return false;
    if (filter?.type && j.type !== filter.type) return false;
    return true;
  });
}
