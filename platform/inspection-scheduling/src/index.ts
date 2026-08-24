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

const InspectionResultSchema = z.enum([
  'pending',
  'passed',
  'failed',
  'rescheduled'
]);

export const InspectionSchema = z.object({
  inspectionId: z.string().uuid(),
  tenantId: z.string().uuid(),
  permitId: z.string().uuid(),
  inspectorName: z.string().min(1).max(200),
  scheduledDate: z.coerce.date(),
  result: InspectionResultSchema,
  notes: z.string().max(5000).nullable()
});

export type Inspection = z.infer<
  typeof InspectionSchema
>;

const inspectionStore = new Map<
  string,
  Inspection
>();

export function __resetInspectionSchedulingStore(): void {
  inspectionStore.clear();
}

function getInspection(
  tenantId: string,
  inspectionId: string
): Inspection {
  const inspection =
    inspectionStore.get(inspectionId);

  if (!inspection) {
    throw new AppError(
      'Inspection not found',
      ErrorCode.NOT_FOUND
    );
  }

  if (inspection.tenantId !== tenantId) {
    throw new AppError(
      'Resource does not belong to tenant',
      ErrorCode.FORBIDDEN
    );
  }

  return inspection;
}

export async function scheduleInspection(
  tenantId: string,
  actorId: string,
  permitId: string,
  inspectorName: string,
  date: Date
): Promise<Inspection> {
  return runCrudOperation({
    configName: 'inspection-scheduling',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (
        !z.string().uuid().safeParse(permitId).success
      ) {
        throw new AppError(
          'Invalid permit ID',
          ErrorCode.BAD_REQUEST
        );
      }

      if (!inspectorName.trim()) {
        throw new AppError(
          'Inspector name is required',
          ErrorCode.BAD_REQUEST
        );
      }

      if (
        !(date instanceof Date) ||
        Number.isNaN(date.getTime())
      ) {
        throw new AppError(
          'Invalid inspection date',
          ErrorCode.BAD_REQUEST
        );
      }

      const inspection =
        InspectionSchema.parse({
          inspectionId: crypto.randomUUID(),
          tenantId,
          permitId,
          inspectorName: inspectorName.trim(),
          scheduledDate: date,
          result: 'pending',
          notes: null
        });

      inspectionStore.set(
        inspection.inspectionId,
        inspection
      );

      return inspection;
    },
    auditAction: 'data.created',
    auditResource: 'inspection_scheduling',
    meterEventType: 'api_call'
  });
}

export async function recordResult(
  tenantId: string,
  actorId: string,
  inspectionId: string,
  result: Inspection['result'],
  notes: string | null = null
): Promise<Inspection> {
  return runCrudOperation({
    configName: 'inspection-scheduling',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const inspection = getInspection(
        tenantId,
        inspectionId
      );

      if (
        result === 'pending' &&
        notes
      ) {
        throw new AppError(
          'Pending inspections cannot have a result note',
          ErrorCode.BAD_REQUEST
        );
      }

      inspection.result = result;
      inspection.notes =
        notes === null
          ? null
          : notes.trim();

      inspectionStore.set(
        inspection.inspectionId,
        inspection
      );

      return inspection;
    },
    auditAction: 'data.updated',
    auditResource: 'inspection_scheduling',
    meterEventType: 'api_call'
  });
}

export async function getPendingInspections(
  tenantId: string,
  actorId: string,
  startDate: Date,
  endDate: Date
): Promise<Inspection[]> {
  return runCrudOperation({
    configName: 'inspection-scheduling',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (
        !(startDate instanceof Date) ||
        Number.isNaN(startDate.getTime()) ||
        !(endDate instanceof Date) ||
        Number.isNaN(endDate.getTime())
      ) {
        throw new AppError(
          'Invalid inspection date range',
          ErrorCode.BAD_REQUEST
        );
      }

      if (endDate < startDate) {
        throw new AppError(
          'End date cannot precede start date',
          ErrorCode.BAD_REQUEST
        );
      }

      return Array.from(
        inspectionStore.values()
      )
        .filter(inspection =>
          inspection.tenantId === tenantId &&
          inspection.result === 'pending' &&
          inspection.scheduledDate >= startDate &&
          inspection.scheduledDate <= endDate
        )
        .sort(
          (a, b) =>
            a.scheduledDate.getTime() -
            b.scheduledDate.getTime()
        );
    },
    auditAction: 'data.read',
    auditResource: 'inspection_scheduling',
    meterEventType: 'api_call'
  });
}
