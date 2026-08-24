import * as crypto from 'crypto';
import { z } from 'zod';
import {
  AppError,
  ErrorCode,
  runCrudOperation
} from '@platform/crud-kernel';

export const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  equipmentTypes: z.array(
    z.enum([
      'pump',
      'filter',
      'heater',
      'chlorinator',
      'other'
    ])
  ).default([
    'pump',
    'filter',
    'heater',
    'chlorinator',
    'other'
  ])
});

export const PoolEquipmentAssetSchema = z.object({
  equipmentId: z.string().uuid(),
  tenantId: z.string().uuid(),
  clientId: z.string().uuid(),
  siteId: z.string().uuid(),
  equipmentType: z.enum([
    'pump',
    'filter',
    'heater',
    'chlorinator',
    'other'
  ]),
  installDate: z.coerce.date(),
  lastServicedDate: z.coerce.date().nullable(),
  nextServiceDue: z.coerce.date().nullable(),
  notes: z.string().max(10000).nullable()
});

export type PoolEquipmentAsset = z.infer<
  typeof PoolEquipmentAssetSchema
>;

const equipmentStore = new Map<
  string,
  PoolEquipmentAsset
>();

const serviceHistoryStore = new Map<
  string,
  Array<{
    visitId: string;
    servicedAt: Date;
    notes: string;
  }>
>();

const replacementFlags = new Map<
  string,
  {
    reason: string;
    flaggedAt: Date;
  }
>();

export function __resetPoolEquipmentAssetStore(): void {
  equipmentStore.clear();
  serviceHistoryStore.clear();
  replacementFlags.clear();
}

function getEquipment(
  tenantId: string,
  equipmentId: string
): PoolEquipmentAsset {
  const equipment =
    equipmentStore.get(equipmentId);

  if (!equipment) {
    throw new AppError(
      'Pool equipment asset not found',
      ErrorCode.NOT_FOUND
    );
  }

  if (equipment.tenantId !== tenantId) {
    throw new AppError(
      'Resource does not belong to tenant',
      ErrorCode.FORBIDDEN
    );
  }

  return equipment;
}

export async function createPoolEquipmentAsset(
  tenantId: string,
  actorId: string,
  clientId: string,
  siteId: string,
  equipmentType: PoolEquipmentAsset['equipmentType'],
  installDate: Date,
  notes: string | null = null
): Promise<PoolEquipmentAsset> {
  return runCrudOperation({
    configName: 'pool-equipment-asset',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (
        !z.string().uuid().safeParse(clientId).success ||
        !z.string().uuid().safeParse(siteId).success
      ) {
        throw new AppError(
          'Invalid client or site ID',
          ErrorCode.BAD_REQUEST
        );
      }

      if (!ConfigSchema.parse({
        enabled: true
      }).equipmentTypes.includes(equipmentType)) {
        throw new AppError(
          'Unsupported equipment type',
          ErrorCode.BAD_REQUEST
        );
      }

      if (
        Number.isNaN(installDate.getTime())
      ) {
        throw new AppError(
          'Invalid installation date',
          ErrorCode.BAD_REQUEST
        );
      }

      const equipment =
        PoolEquipmentAssetSchema.parse({
          equipmentId: crypto.randomUUID(),
          tenantId,
          clientId,
          siteId,
          equipmentType,
          installDate,
          lastServicedDate: null,
          nextServiceDue: null,
          notes
        });

      equipmentStore.set(
        equipment.equipmentId,
        equipment
      );

      return equipment;
    },
    auditAction: 'data.created',
    auditResource: 'pool_equipment_asset',
    meterEventType: 'api_call'
  });
}

export async function logService(
  tenantId: string,
  actorId: string,
  equipmentId: string,
  visitId: string,
  notes: string = ''
): Promise<PoolEquipmentAsset> {
  return runCrudOperation({
    configName: 'pool-equipment-asset',
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

      const equipment = getEquipment(
        tenantId,
        equipmentId
      );

      const history =
        serviceHistoryStore.get(equipmentId) ?? [];

      history.push({
        visitId,
        servicedAt: new Date(),
        notes
      });

      serviceHistoryStore.set(
        equipmentId,
        history
      );

      equipment.lastServicedDate = new Date();

      equipmentStore.set(
        equipmentId,
        equipment
      );

      return equipment;
    },
    auditAction: 'data.updated',
    auditResource: 'pool_equipment_asset',
    meterEventType: 'api_call'
  });
}

export async function getUpcomingServiceDue(
  tenantId: string,
  actorId: string,
  daysAhead: number
): Promise<PoolEquipmentAsset[]> {
  return runCrudOperation({
    configName: 'pool-equipment-asset',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (
        !Number.isInteger(daysAhead) ||
        daysAhead < 0
      ) {
        throw new AppError(
          'Days ahead must be a non-negative integer',
          ErrorCode.BAD_REQUEST
        );
      }

      const now = new Date();
      const cutoff = new Date(now);
      cutoff.setDate(
        cutoff.getDate() + daysAhead
      );

      return Array.from(
        equipmentStore.values()
      ).filter(equipment => {
        if (
          equipment.tenantId !== tenantId ||
          !equipment.nextServiceDue
        ) {
          return false;
        }

        return (
          equipment.nextServiceDue >= now &&
          equipment.nextServiceDue <= cutoff
        );
      });
    },
    auditAction: 'data.read',
    auditResource: 'pool_equipment_asset',
    meterEventType: 'api_call'
  });
}

export async function flagReplacementNeeded(
  tenantId: string,
  actorId: string,
  equipmentId: string,
  reason: string
): Promise<{
  equipmentId: string;
  reason: string;
  flaggedAt: Date;
}> {
  return runCrudOperation({
    configName: 'pool-equipment-asset',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      getEquipment(
        tenantId,
        equipmentId
      );

      if (!reason.trim()) {
        throw new AppError(
          'Replacement reason is required',
          ErrorCode.BAD_REQUEST
        );
      }

      const flag = {
        equipmentId,
        reason: reason.trim(),
        flaggedAt: new Date()
      };

      replacementFlags.set(
        equipmentId,
        {
          reason: flag.reason,
          flaggedAt: flag.flaggedAt
        }
      );

      return flag;
    },
    auditAction: 'data.updated',
    auditResource: 'pool_equipment_asset',
    meterEventType: 'api_call'
  });
}

export async function getPoolEquipmentAsset(
  tenantId: string,
  actorId: string,
  equipmentId: string
): Promise<PoolEquipmentAsset> {
  return runCrudOperation({
    configName: 'pool-equipment-asset',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () =>
      getEquipment(
        tenantId,
        equipmentId
      ),
    auditAction: 'data.read',
    auditResource: 'pool_equipment_asset',
    meterEventType: 'api_call'
  });
}
