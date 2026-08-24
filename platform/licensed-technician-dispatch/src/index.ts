import * as crypto from 'crypto';
import { z } from 'zod';
import {
  AppError,
  ErrorCode,
  runCrudOperation
} from '@platform/crud-kernel';

export const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  licenseTypes: z.array(
    z.enum([
      'hvac',
      'plumbing',
      'electrical',
      'gas_fitting'
    ])
  ).default([
    'hvac',
    'plumbing',
    'electrical',
    'gas_fitting'
  ])
});

const LicenseTypeSchema = z.enum([
  'hvac',
  'plumbing',
  'electrical',
  'gas_fitting'
]);

const PrioritySchema = z.enum([
  'routine',
  'urgent',
  'emergency'
]);

const StatusSchema = z.enum([
  'unassigned',
  'assigned',
  'in_progress',
  'completed'
]);

export const DispatchJobSchema = z.object({
  jobId: z.string().uuid(),
  tenantId: z.string().uuid(),
  requiredLicenseType: LicenseTypeSchema,
  technicianId: z.string().uuid().nullable(),
  scheduledDate: z.coerce.date(),
  priority: PrioritySchema,
  status: StatusSchema
});

export type DispatchJob = z.infer<
  typeof DispatchJobSchema
>;

export const TechnicianProfileSchema = z.object({
  technicianId: z.string().uuid(),
  tenantId: z.string().uuid(),
  licenseTypes: z.array(LicenseTypeSchema),
  availableDates: z.array(z.string())
});

export type TechnicianProfile = z.infer<
  typeof TechnicianProfileSchema
>;

const jobStore = new Map<string, DispatchJob>();
const technicianStore =
  new Map<string, TechnicianProfile>();

export function __resetLicensedTechnicianDispatchStore(): void {
  jobStore.clear();
  technicianStore.clear();
}

export function __registerTechnician(
  profile: TechnicianProfile
): void {
  technicianStore.set(
    profile.technicianId,
    TechnicianProfileSchema.parse(profile)
  );
}

function getJob(
  tenantId: string,
  jobId: string
): DispatchJob {
  const job = jobStore.get(jobId);

  if (!job) {
    throw new AppError(
      'Dispatch job not found',
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

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getMatchingTechnicians(
  tenantId: string,
  requiredLicenseType: DispatchJob['requiredLicenseType'],
  scheduledDate: Date
): TechnicianProfile[] {
  const requestedDate = dateKey(scheduledDate);

  return Array.from(
    technicianStore.values()
  ).filter(technician =>
    technician.tenantId === tenantId &&
    technician.licenseTypes.includes(
      requiredLicenseType
    ) &&
    technician.availableDates.includes(
      requestedDate
    )
  );
}

export async function createDispatchJob(
  tenantId: string,
  actorId: string,
  requiredLicenseType: DispatchJob['requiredLicenseType'],
  scheduledDate: Date,
  priority: DispatchJob['priority'] = 'routine'
): Promise<DispatchJob> {
  return runCrudOperation({
    configName: 'licensed-technician-dispatch',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (Number.isNaN(scheduledDate.getTime())) {
        throw new AppError(
          'Invalid scheduled date',
          ErrorCode.BAD_REQUEST
        );
      }

      const job = DispatchJobSchema.parse({
        jobId: crypto.randomUUID(),
        tenantId,
        requiredLicenseType,
        technicianId: null,
        scheduledDate,
        priority,
        status: 'unassigned'
      });

      jobStore.set(
        job.jobId,
        job
      );

      return job;
    },
    auditAction: 'data.created',
    auditResource: 'licensed_technician_dispatch',
    meterEventType: 'api_call'
  });
}

export async function matchTechnician(
  tenantId: string,
  actorId: string,
  jobId: string
): Promise<TechnicianProfile | null> {
  return runCrudOperation({
    configName: 'licensed-technician-dispatch',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const job = getJob(
        tenantId,
        jobId
      );

      const matches =
        getMatchingTechnicians(
          tenantId,
          job.requiredLicenseType,
          job.scheduledDate
        );

      return matches[0] ?? null;
    },
    auditAction: 'data.read',
    auditResource: 'licensed_technician_dispatch',
    meterEventType: 'api_call'
  });
}

export async function assignJob(
  tenantId: string,
  actorId: string,
  jobId: string,
  technicianId: string
): Promise<DispatchJob> {
  return runCrudOperation({
    configName: 'licensed-technician-dispatch',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const job = getJob(
        tenantId,
        jobId
      );

      const technician =
        technicianStore.get(technicianId);

      if (
        !technician ||
        technician.tenantId !== tenantId
      ) {
        throw new AppError(
          'Technician not found',
          ErrorCode.NOT_FOUND
        );
      }

      if (
        !technician.licenseTypes.includes(
          job.requiredLicenseType
        )
      ) {
        throw new AppError(
          'Technician does not hold the required license',
          ErrorCode.FORBIDDEN
        );
      }

      if (
        !technician.availableDates.includes(
          dateKey(job.scheduledDate)
        )
      ) {
        throw new AppError(
          'Technician is unavailable on the scheduled date',
          ErrorCode.CONFLICT
        );
      }

      job.technicianId = technicianId;
      job.status = 'assigned';

      jobStore.set(
        job.jobId,
        job
      );

      return job;
    },
    auditAction: 'data.updated',
    auditResource: 'licensed_technician_dispatch',
    meterEventType: 'api_call'
  });
}

export async function escalatePriority(
  tenantId: string,
  actorId: string,
  jobId: string,
  newPriority: DispatchJob['priority']
): Promise<DispatchJob> {
  return runCrudOperation({
    configName: 'licensed-technician-dispatch',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const job = getJob(
        tenantId,
        jobId
      );

      job.priority = newPriority;

      jobStore.set(
        job.jobId,
        job
      );

      return job;
    },
    auditAction: 'data.updated',
    auditResource: 'licensed_technician_dispatch',
    meterEventType: 'api_call'
  });
}

export async function getTechnicianSchedule(
  tenantId: string,
  actorId: string,
  technicianId: string,
  date: Date
): Promise<DispatchJob[]> {
  return runCrudOperation({
    configName: 'licensed-technician-dispatch',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (Number.isNaN(date.getTime())) {
        throw new AppError(
          'Invalid schedule date',
          ErrorCode.BAD_REQUEST
        );
      }

      const technician =
        technicianStore.get(technicianId);

      if (
        !technician ||
        technician.tenantId !== tenantId
      ) {
        throw new AppError(
          'Technician not found',
          ErrorCode.NOT_FOUND
        );
      }

      const requestedDate = dateKey(date);

      return Array.from(
        jobStore.values()
      ).filter(job =>
        job.tenantId === tenantId &&
        job.technicianId === technicianId &&
        dateKey(job.scheduledDate) === requestedDate
      );
    },
    auditAction: 'data.read',
    auditResource: 'licensed_technician_dispatch',
    meterEventType: 'api_call'
  });
}
