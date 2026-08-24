import * as crypto from 'crypto';
import { z } from 'zod';
import {
  AppError,
  ErrorCode,
  runCrudOperation
} from '@platform/crud-kernel';

export const ConfigSchema = z.object({
  enabled: z.boolean().default(true)
});

const PhotoSchema = z.object({
  type: z.enum(['before', 'after']),
  url: z.string().url()
});

const JobSchema = z.object({
  jobId: z.string().uuid(),
  tenantId: z.string().uuid(),
  requestId: z.string().uuid(),
  clientId: z.string().uuid(),
  driverId: z.string().uuid(),
  arrivalTimestamp: z.coerce.date().nullable(),
  completionTimestamp: z.coerce.date().nullable(),
  photos: z.array(PhotoSchema),
  notes: z.string().max(5000).nullable(),
  customerSignatureCaptured: z.boolean()
});

export type JobPhoto = z.infer<typeof PhotoSchema>;
export type SingleVisitJob = z.infer<typeof JobSchema>;

const jobStore = new Map<string, SingleVisitJob>();

export function __resetSingleVisitJobRecordStore(): void {
  jobStore.clear();
}

function getJob(
  tenantId: string,
  jobId: string
): SingleVisitJob {
  const job = jobStore.get(jobId);

  if (!job) {
    throw new AppError(
      'Job not found',
      ErrorCode.NOT_FOUND
    );
  }

  if (job.tenantId !== tenantId) {
    throw new AppError(
      'Resource does not belong to tenant',
      ErrorCode.FORBIDDEN
    );
  }

  return job;
}

export async function startJob(
  tenantId: string,
  actorId: string,
  requestId: string,
  driverId: string,
  clientId: string
): Promise<SingleVisitJob> {
  return runCrudOperation({
    configName: 'single-visit-job-record',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!z.string().uuid().safeParse(requestId).success) {
        throw new AppError(
          'Invalid request ID',
          ErrorCode.BAD_REQUEST
        );
      }

      if (!z.string().uuid().safeParse(driverId).success) {
        throw new AppError(
          'Invalid driver ID',
          ErrorCode.BAD_REQUEST
        );
      }

      if (!z.string().uuid().safeParse(clientId).success) {
        throw new AppError(
          'Invalid client ID',
          ErrorCode.BAD_REQUEST
        );
      }

      const existing = Array.from(jobStore.values())
        .find(
          job =>
            job.tenantId === tenantId &&
            job.requestId === requestId
        );

      if (existing) {
        throw new AppError(
          'A job already exists for this request',
          ErrorCode.CONFLICT
        );
      }

      const job = JobSchema.parse({
        jobId: crypto.randomUUID(),
        tenantId,
        requestId,
        clientId,
        driverId,
        arrivalTimestamp: new Date(),
        completionTimestamp: null,
        photos: [],
        notes: null,
        customerSignatureCaptured: false
      });

      jobStore.set(job.jobId, job);

      return job;
    },
    auditAction: 'data.created',
    auditResource: 'single_visit_job',
    meterEventType: 'api_call'
  });
}

export async function completeJob(
  tenantId: string,
  actorId: string,
  jobId: string,
  notes: string,
  photos: JobPhoto[] = [],
  customerSignatureCaptured = false
): Promise<SingleVisitJob> {
  return runCrudOperation({
    configName: 'single-visit-job-record',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const job = getJob(tenantId, jobId);

      if (job.completionTimestamp) {
        throw new AppError(
          'Job is already completed',
          ErrorCode.CONFLICT
        );
      }

      const parsedPhotos = z.array(PhotoSchema)
        .safeParse(photos);

      if (!parsedPhotos.success) {
        throw new AppError(
          'Invalid job photos',
          ErrorCode.BAD_REQUEST
        );
      }

      job.notes = notes.trim() || null;
      job.photos = parsedPhotos.data;
      job.customerSignatureCaptured =
        customerSignatureCaptured;
      job.completionTimestamp = new Date();

      jobStore.set(job.jobId, job);

      return job;
    },
    auditAction: 'data.updated',
    auditResource: 'single_visit_job',
    meterEventType: 'api_call'
  });
}

export async function getJobHistory(
  tenantId: string,
  actorId: string,
  clientId: string
): Promise<SingleVisitJob[]> {
  return runCrudOperation({
    configName: 'single-visit-job-record',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!z.string().uuid().safeParse(clientId).success) {
        throw new AppError(
          'Invalid client ID',
          ErrorCode.BAD_REQUEST
        );
      }

      return Array.from(jobStore.values())
        .filter(
          job =>
            job.tenantId === tenantId &&
            job.clientId === clientId
        );
    },
    auditAction: 'data.read',
    auditResource: 'single_visit_job',
    meterEventType: 'api_call'
  });
}
