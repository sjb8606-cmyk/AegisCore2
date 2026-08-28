/**
 * platform/haul-out-yard-schedule (MAR-04)
 *
 * Travel-lift slots + yard storage blocks. Conflict-aware booking.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('haul-out-yard-schedule');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  defaultSlotMinutes: z.number().int().positive().default(120),
  maxYardBlocks: z.number().int().positive().default(50),
});

export type HaulJobType = 'haul_out' | 'splash' | 'block_only';
export type HaulJobStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled';

export interface HaulJob {
  id: string;
  tenantId: string;
  vesselId: string;
  jobType: HaulJobType;
  liftStart: string;
  liftEnd: string;
  yardBlockId: string | null;
  status: HaulJobStatus;
  notes: string | null;
  createdAt: string;
}

export interface YardBlock {
  id: string;
  tenantId: string;
  label: string;
  occupiedByJobId: string | null;
  vesselId: string | null;
}

const jobs = new Map<string, HaulJob>();
const blocks = new Map<string, YardBlock>();

export function __resetHaulOutYardStore(): void {
  jobs.clear();
  blocks.clear();
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function liftConflict(
  tenantId: string,
  start: number,
  end: number,
  excludeJobId?: string,
): boolean {
  for (const j of jobs.values()) {
    if (j.tenantId !== tenantId) continue;
    if (j.status === 'cancelled' || j.status === 'completed') continue;
    if (excludeJobId && j.id === excludeJobId) continue;
    if (j.jobType === 'block_only') continue;
    const s = Date.parse(j.liftStart);
    const e = Date.parse(j.liftEnd);
    if (overlaps(start, end, s, e)) return true;
  }
  return false;
}

export async function registerYardBlock(
  tenantId: string,
  actorId: string,
  input: { label: string },
): Promise<YardBlock> {
  return runCrudOperation({
    configName: 'haul-out-yard-schedule',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('haul-out-yard-schedule', ConfigSchema);
      if (!input.label?.trim()) {
        throw new AppError('label required', ErrorCode.BAD_REQUEST);
      }
      const count = [...blocks.values()].filter((b) => b.tenantId === tenantId).length;
      if (count >= config.maxYardBlocks) {
        throw new AppError('Max yard blocks reached', ErrorCode.CONFLICT);
      }
      const block: YardBlock = {
        id: crypto.randomUUID(),
        tenantId,
        label: input.label.trim(),
        occupiedByJobId: null,
        vesselId: null,
      };
      blocks.set(block.id, block);
      return block;
    },
    auditAction: 'data.created',
    auditResource: 'marina_yard_block',
    meterEventType: 'api_call',
  });
}

export async function scheduleHaulJob(
  tenantId: string,
  actorId: string,
  input: {
    vesselId: string;
    jobType: HaulJobType;
    liftStart: string;
    liftEnd?: string;
    yardBlockId?: string;
    notes?: string;
  },
): Promise<HaulJob> {
  return runCrudOperation({
    configName: 'haul-out-yard-schedule',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('haul-out-yard-schedule', ConfigSchema);
      if (!input.vesselId?.trim()) {
        throw new AppError('vesselId required', ErrorCode.BAD_REQUEST);
      }
      if (!['haul_out', 'splash', 'block_only'].includes(input.jobType)) {
        throw new AppError('invalid jobType', ErrorCode.BAD_REQUEST);
      }
      const start = Date.parse(input.liftStart);
      if (Number.isNaN(start)) {
        throw new AppError('invalid liftStart', ErrorCode.BAD_REQUEST);
      }
      const end = input.liftEnd
        ? Date.parse(input.liftEnd)
        : start + config.defaultSlotMinutes * 60_000;
      if (Number.isNaN(end) || end <= start) {
        throw new AppError('invalid liftEnd', ErrorCode.BAD_REQUEST);
      }

      if (input.jobType !== 'block_only' && liftConflict(tenantId, start, end)) {
        throw new AppError('Travel-lift slot conflict', ErrorCode.CONFLICT);
      }

      let yardBlockId: string | null = input.yardBlockId || null;
      if (input.jobType === 'haul_out') {
        if (!yardBlockId) {
          throw new AppError('yardBlockId required for haul_out', ErrorCode.BAD_REQUEST);
        }
        const block = blocks.get(yardBlockId);
        if (!block || block.tenantId !== tenantId) {
          throw new AppError('Yard block not found', ErrorCode.NOT_FOUND);
        }
        if (block.occupiedByJobId) {
          throw new AppError('Yard block occupied', ErrorCode.CONFLICT);
        }
      }

      const job: HaulJob = {
        id: crypto.randomUUID(),
        tenantId,
        vesselId: input.vesselId,
        jobType: input.jobType,
        liftStart: new Date(start).toISOString(),
        liftEnd: new Date(end).toISOString(),
        yardBlockId,
        status: 'scheduled',
        notes: input.notes?.trim() || null,
        createdAt: new Date().toISOString(),
      };
      jobs.set(job.id, job);

      if (yardBlockId && input.jobType === 'haul_out') {
        const block = blocks.get(yardBlockId)!;
        block.occupiedByJobId = job.id;
        block.vesselId = input.vesselId;
        blocks.set(yardBlockId, block);
      }

      logger.info({ jobId: job.id, jobType: job.jobType }, 'Haul job scheduled');
      return job;
    },
    auditAction: 'data.created',
    auditResource: 'marina_haul_job',
    meterEventType: 'api_call',
  });
}

export async function completeHaulJob(
  tenantId: string,
  actorId: string,
  jobId: string,
  releaseYardBlock = false,
): Promise<HaulJob> {
  return runCrudOperation({
    configName: 'haul-out-yard-schedule',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const job = jobs.get(jobId);
      if (!job || job.tenantId !== tenantId) {
        throw new AppError('Job not found', ErrorCode.NOT_FOUND);
      }
      if (job.status === 'cancelled' || job.status === 'completed') {
        throw new AppError('Job already closed', ErrorCode.CONFLICT);
      }
      job.status = 'completed';
      jobs.set(jobId, job);
      if (releaseYardBlock && job.yardBlockId) {
        const block = blocks.get(job.yardBlockId);
        if (block && block.occupiedByJobId === jobId) {
          block.occupiedByJobId = null;
          block.vesselId = null;
          blocks.set(job.yardBlockId, block);
        }
      }
      return job;
    },
    auditAction: 'data.updated',
    auditResource: 'marina_haul_job',
    meterEventType: 'api_call',
  });
}

export async function cancelHaulJob(
  tenantId: string,
  actorId: string,
  jobId: string,
): Promise<HaulJob> {
  return runCrudOperation({
    configName: 'haul-out-yard-schedule',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const job = jobs.get(jobId);
      if (!job || job.tenantId !== tenantId) {
        throw new AppError('Job not found', ErrorCode.NOT_FOUND);
      }
      if (job.status === 'completed') {
        throw new AppError('Cannot cancel completed job', ErrorCode.CONFLICT);
      }
      job.status = 'cancelled';
      jobs.set(jobId, job);
      if (job.yardBlockId) {
        const block = blocks.get(job.yardBlockId);
        if (block && block.occupiedByJobId === jobId) {
          block.occupiedByJobId = null;
          block.vesselId = null;
          blocks.set(job.yardBlockId, block);
        }
      }
      return job;
    },
    auditAction: 'data.updated',
    auditResource: 'marina_haul_job',
    meterEventType: 'api_call',
  });
}

export async function listLiftSchedule(
  tenantId: string,
  actorId: string,
  fromIso: string,
  toIso: string,
): Promise<HaulJob[]> {
  return runCrudOperation({
    configName: 'haul-out-yard-schedule',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const from = Date.parse(fromIso);
      const to = Date.parse(toIso);
      if (Number.isNaN(from) || Number.isNaN(to)) {
        throw new AppError('invalid range', ErrorCode.BAD_REQUEST);
      }
      return [...jobs.values()]
        .filter((j) => {
          if (j.tenantId !== tenantId) return false;
          if (j.status === 'cancelled') return false;
          const s = Date.parse(j.liftStart);
          return s >= from && s <= to;
        })
        .sort((a, b) => Date.parse(a.liftStart) - Date.parse(b.liftStart));
    },
    auditAction: 'data.read',
    auditResource: 'marina_haul_job',
    meterEventType: 'api_call',
  });
}
