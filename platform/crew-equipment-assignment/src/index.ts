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

export const AssignmentSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  visitId: z.string().uuid(),
  crewMemberIds: z.array(z.string().uuid()),
  equipmentIds: z.array(z.string().uuid()),
  status: z.enum([
    'assigned',
    'in_progress',
    'completed'
  ])
});

export type CrewEquipmentAssignment = z.infer<
  typeof AssignmentSchema
>;

const assignmentStore = new Map<
  string,
  CrewEquipmentAssignment
>();

const crewScheduleStore = new Map<
  string,
  Set<string>
>();

const equipmentScheduleStore = new Map<
  string,
  Set<string>
>();

export function __resetCrewEquipmentAssignmentStore(): void {
  assignmentStore.clear();
  crewScheduleStore.clear();
  equipmentScheduleStore.clear();
}

function getAssignment(
  tenantId: string,
  visitId: string
): CrewEquipmentAssignment {
  const assignment = Array.from(
    assignmentStore.values()
  ).find(
    item =>
      item.tenantId === tenantId &&
      item.visitId === visitId
  );

  if (!assignment) {
    throw new AppError(
      'Crew equipment assignment not found',
      ErrorCode.NOT_FOUND
    );
  }

  return assignment;
}

function markScheduled(
  store: Map<string, Set<string>>,
  resourceId: string,
  date: string
): void {
  const dates =
    store.get(resourceId) ?? new Set<string>();

  dates.add(date);
  store.set(resourceId, dates);
}

function hasScheduled(
  store: Map<string, Set<string>>,
  resourceId: string,
  date: string
): boolean {
  return store.get(resourceId)?.has(date) ?? false;
}

export async function assignCrew(
  tenantId: string,
  actorId: string,
  visitId: string,
  crewMemberIds: string[],
  date: string = new Date()
    .toISOString()
    .slice(0, 10)
): Promise<CrewEquipmentAssignment> {
  return runCrudOperation({
    configName: 'crew-equipment-assignment',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!z.string().uuid().safeParse(visitId).success) {
        throw new AppError(
          'Invalid visit ID',
          ErrorCode.BAD_REQUEST
        );
      }

      if (
        crewMemberIds.length === 0 ||
        crewMemberIds.some(
          id => !z.string().uuid().safeParse(id).success
        )
      ) {
        throw new AppError(
          'At least one valid crew member is required',
          ErrorCode.BAD_REQUEST
        );
      }

      const existing = assignmentStore.get(visitId);

      if (
        existing &&
        existing.tenantId !== tenantId
      ) {
        throw new AppError(
          'Resource does not belong to tenant',
          ErrorCode.FORBIDDEN
        );
      }

      if (existing?.status === 'completed') {
        throw new AppError(
          'Completed assignment cannot be changed',
          ErrorCode.CONFLICT
        );
      }

      const uniqueCrew = [
        ...new Set(crewMemberIds)
      ];

      for (const crewMemberId of uniqueCrew) {
        if (
          hasScheduled(
            crewScheduleStore,
            crewMemberId,
            date
          )
        ) {
          throw new AppError(
            'Crew member has an assignment conflict',
            ErrorCode.CONFLICT
          );
        }
      }

      const assignment =
        existing ??
        AssignmentSchema.parse({
          id: crypto.randomUUID(),
          tenantId,
          visitId,
          crewMemberIds: [],
          equipmentIds: [],
          status: 'assigned'
        });

      assignment.crewMemberIds = uniqueCrew;

      assignmentStore.set(
        visitId,
        assignment
      );

      for (const crewMemberId of uniqueCrew) {
        markScheduled(
          crewScheduleStore,
          crewMemberId,
          date
        );
      }

      return assignment;
    },
    auditAction: 'data.updated',
    auditResource: 'crew_equipment_assignment',
    meterEventType: 'api_call'
  });
}

export async function assignEquipment(
  tenantId: string,
  actorId: string,
  visitId: string,
  equipmentIds: string[],
  date: string = new Date()
    .toISOString()
    .slice(0, 10)
): Promise<CrewEquipmentAssignment> {
  return runCrudOperation({
    configName: 'crew-equipment-assignment',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!z.string().uuid().safeParse(visitId).success) {
        throw new AppError(
          'Invalid visit ID',
          ErrorCode.BAD_REQUEST
        );
      }

      if (
        equipmentIds.some(
          id => !z.string().uuid().safeParse(id).success
        )
      ) {
        throw new AppError(
          'Invalid equipment ID',
          ErrorCode.BAD_REQUEST
        );
      }

      const existing = assignmentStore.get(visitId);

      if (!existing) {
        throw new AppError(
          'Assign crew before assigning equipment',
          ErrorCode.NOT_FOUND
        );
      }

      if (existing.tenantId !== tenantId) {
        throw new AppError(
          'Resource does not belong to tenant',
          ErrorCode.FORBIDDEN
        );
      }

      if (existing.status === 'completed') {
        throw new AppError(
          'Completed assignment cannot be changed',
          ErrorCode.CONFLICT
        );
      }

      const uniqueEquipment = [
        ...new Set(equipmentIds)
      ];

      for (const equipmentId of uniqueEquipment) {
        if (
          hasScheduled(
            equipmentScheduleStore,
            equipmentId,
            date
          )
        ) {
          throw new AppError(
            'Equipment has an assignment conflict',
            ErrorCode.CONFLICT
          );
        }
      }

      existing.equipmentIds = uniqueEquipment;

      assignmentStore.set(
        visitId,
        existing
      );

      for (const equipmentId of uniqueEquipment) {
        markScheduled(
          equipmentScheduleStore,
          equipmentId,
          date
        );
      }

      return existing;
    },
    auditAction: 'data.updated',
    auditResource: 'crew_equipment_assignment',
    meterEventType: 'api_call'
  });
}

export async function checkAvailability(
  tenantId: string,
  actorId: string,
  crewMemberId: string,
  date: string
): Promise<boolean> {
  return runCrudOperation({
    configName: 'crew-equipment-assignment',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (
        !z.string().uuid().safeParse(crewMemberId).success
      ) {
        throw new AppError(
          'Invalid crew member ID',
          ErrorCode.BAD_REQUEST
        );
      }

      void tenantId;

      return !hasScheduled(
        crewScheduleStore,
        crewMemberId,
        date
      );
    },
    auditAction: 'data.read',
    auditResource: 'crew_equipment_assignment',
    meterEventType: 'api_call'
  });
}

export async function checkEquipmentConflict(
  tenantId: string,
  actorId: string,
  equipmentId: string,
  date: string
): Promise<boolean> {
  return runCrudOperation({
    configName: 'crew-equipment-assignment',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (
        !z.string().uuid().safeParse(equipmentId).success
      ) {
        throw new AppError(
          'Invalid equipment ID',
          ErrorCode.BAD_REQUEST
        );
      }

      void tenantId;

      return hasScheduled(
        equipmentScheduleStore,
        equipmentId,
        date
      );
    },
    auditAction: 'data.read',
    auditResource: 'crew_equipment_assignment',
    meterEventType: 'api_call'
  });
}

export async function getAssignmentByVisit(
  tenantId: string,
  actorId: string,
  visitId: string
): Promise<CrewEquipmentAssignment> {
  return runCrudOperation({
    configName: 'crew-equipment-assignment',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () =>
      getAssignment(tenantId, visitId),
    auditAction: 'data.read',
    auditResource: 'crew_equipment_assignment',
    meterEventType: 'api_call'
  });
}
