import * as crypto from 'crypto';
import { z } from 'zod';
import {
  AppError,
  ErrorCode,
  runCrudOperation
} from '@platform/crud-kernel';

export const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  checklist: z.object({
    requiredFields: z.array(z.string()).default([])
  }).default({
    requiredFields: []
  })
});

export type Config = z.infer<typeof ConfigSchema>;

export const PhotoSchema = z.object({
  before: z.array(z.string().url()).default([]),
  after: z.array(z.string().url()).default([])
});

export const VisitLogSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  visitId: z.string().uuid(),
  contractId: z.string().uuid(),
  technicianId: z.string().uuid(),
  arrivalTimestamp: z.coerce.date().nullable(),
  departureTimestamp: z.coerce.date().nullable(),
  notes: z.string().max(10000).default(''),
  photos: PhotoSchema,
  checklistData: z.record(z.unknown())
});

export type VisitLog = z.infer<typeof VisitLogSchema>;

const visitLogStore = new Map<string, VisitLog>();

export function __resetServiceVisitLogStore(): void {
  visitLogStore.clear();
}

function getVisitLog(
  tenantId: string,
  visitId: string
): VisitLog {
  const log = visitLogStore.get(visitId);

  if (!log) {
    throw new AppError(
      'Service visit log not found',
      ErrorCode.NOT_FOUND
    );
  }

  if (log.tenantId !== tenantId) {
    throw new AppError(
      'Resource does not belong to tenant',
      ErrorCode.FORBIDDEN
    );
  }

  return log;
}

function validateChecklist(
  checklistData: Record<string, unknown>,
  requiredFields: string[]
): void {
  const missing = requiredFields.filter(
    field =>
      checklistData[field] === undefined ||
      checklistData[field] === null
  );

  if (missing.length > 0) {
    throw new AppError(
      'Required checklist fields are missing: ' + missing.join(', '),
      ErrorCode.BAD_REQUEST
    );
  }
}

export async function createVisitLog(
  tenantId: string,
  actorId: string,
  input: Omit<VisitLog, 'id' | 'tenantId'>
): Promise<VisitLog> {
  return runCrudOperation({
    configName: 'service-visit-log',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (visitLogStore.has(input.visitId)) {
        throw new AppError(
          'A service visit log already exists',
          ErrorCode.CONFLICT
        );
      }

      const log = VisitLogSchema.parse({
        id: crypto.randomUUID(),
        tenantId,
        ...input
      });

      visitLogStore.set(log.visitId, log);
      return log;
    },
    auditAction: 'data.created',
    auditResource: 'service_visit_log',
    meterEventType: 'api_call'
  });
}

export async function startVisit(
  tenantId: string,
  actorId: string,
  visitId: string
): Promise<VisitLog> {
  return runCrudOperation({
    configName: 'service-visit-log',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const log = getVisitLog(tenantId, visitId);

      if (log.arrivalTimestamp) {
        throw new AppError(
          'Visit has already been started',
          ErrorCode.CONFLICT
        );
      }

      log.arrivalTimestamp = new Date();
      visitLogStore.set(log.visitId, log);

      return log;
    },
    auditAction: 'data.updated',
    auditResource: 'service_visit_log',
    meterEventType: 'api_call'
  });
}

export async function completeVisit(
  tenantId: string,
  actorId: string,
  visitId: string,
  checklistData: Record<string, unknown>
): Promise<VisitLog> {
  return runCrudOperation({
    configName: 'service-visit-log',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = ConfigSchema.parse({
        enabled: true,
        checklist: {
          requiredFields: []
        }
      });

      const log = getVisitLog(tenantId, visitId);

      validateChecklist(
        checklistData,
        config.checklist.requiredFields
      );

      if (!log.arrivalTimestamp) {
        throw new AppError(
          'Visit must be started before completion',
          ErrorCode.CONFLICT
        );
      }

      if (log.departureTimestamp) {
        throw new AppError(
          'Visit has already been completed',
          ErrorCode.CONFLICT
        );
      }

      log.checklistData = { ...checklistData };
      log.departureTimestamp = new Date();

      visitLogStore.set(log.visitId, log);

      return log;
    },
    auditAction: 'data.updated',
    auditResource: 'service_visit_log',
    meterEventType: 'api_call'
  });
}

export async function getClientVisibleHistory(
  tenantId: string,
  actorId: string,
  clientId: string
): Promise<VisitLog[]> {
  return runCrudOperation({
    configName: 'service-visit-log',
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

      return Array.from(visitLogStore.values())
        .filter(log => log.tenantId === tenantId)
        .sort(
          (a, b) =>
            (a.arrivalTimestamp?.getTime() ?? 0) -
            (b.arrivalTimestamp?.getTime() ?? 0)
        );
    },
    auditAction: 'data.read',
    auditResource: 'service_visit_log',
    meterEventType: 'api_call'
  });
}
