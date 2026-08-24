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

const SystemTypeSchema = z.enum([
  'furnace',
  'ac',
  'heat_pump',
  'ductless_mini_split'
]);

export const EquipmentSchema = z.object({
  equipmentId: z.string().uuid(),
  tenantId: z.string().uuid(),
  clientId: z.string().uuid(),
  propertyId: z.string().uuid(),
  systemType: SystemTypeSchema,
  manufacturer: z.string().min(1).max(200),
  modelNumber: z.string().min(1).max(200),
  serialNumber: z.string().min(1).max(200),
  installDate: z.coerce.date(),
  refrigerantType: z.string().min(1).max(100),
  warrantyExpiryDate: z.coerce.date().nullable()
});

export type HvacEquipment =
  z.infer<typeof EquipmentSchema>;

const equipmentStore = new Map<
  string,
  HvacEquipment
>();

export function __resetHvacEquipmentRegistryStore(): void {
  equipmentStore.clear();
}

function getEquipment(
  tenantId: string,
  equipmentId: string
): HvacEquipment {
  const equipment =
    equipmentStore.get(equipmentId);

  if (!equipment) {
    throw new AppError(
      'HVAC equipment not found',
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

export async function registerEquipment(
  tenantId: string,
  actorId: string,
  clientId: string,
  propertyId: string,
  systemData: {
    systemType: HvacEquipment['systemType'];
    manufacturer: string;
    modelNumber: string;
    serialNumber: string;
    installDate: Date;
    refrigerantType: string;
    warrantyExpiryDate?: Date | null;
  }
): Promise<HvacEquipment> {
  return runCrudOperation({
    configName: 'hvac-equipment-registry',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (
        !z.string().uuid().safeParse(clientId).success
      ) {
        throw new AppError(
          'Invalid client ID',
          ErrorCode.BAD_REQUEST
        );
      }

      if (
        !z.string().uuid().safeParse(propertyId).success
      ) {
        throw new AppError(
          'Invalid property ID',
          ErrorCode.BAD_REQUEST
        );
      }

      const equipment =
        EquipmentSchema.parse({
          equipmentId: crypto.randomUUID(),
          tenantId,
          clientId,
          propertyId,
          systemType: systemData.systemType,
          manufacturer: systemData.manufacturer.trim(),
          modelNumber: systemData.modelNumber.trim(),
          serialNumber: systemData.serialNumber.trim(),
          installDate: systemData.installDate,
          refrigerantType:
            systemData.refrigerantType.trim(),
          warrantyExpiryDate:
            systemData.warrantyExpiryDate ?? null
        });

      const duplicate = Array.from(
        equipmentStore.values()
      ).find(
        item =>
          item.tenantId === tenantId &&
          item.serialNumber === equipment.serialNumber
      );

      if (duplicate) {
        throw new AppError(
          'Equipment serial number already registered',
          ErrorCode.CONFLICT
        );
      }

      equipmentStore.set(
        equipment.equipmentId,
        equipment
      );

      return equipment;
    },
    auditAction: 'data.created',
    auditResource: 'hvac_equipment',
    meterEventType: 'api_call'
  });
}

export async function getEquipmentHistory(
  tenantId: string,
  actorId: string,
  equipmentId: string
): Promise<HvacEquipment> {
  return runCrudOperation({
    configName: 'hvac-equipment-registry',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () =>
      getEquipment(
        tenantId,
        equipmentId
      ),
    auditAction: 'data.read',
    auditResource: 'hvac_equipment',
    meterEventType: 'api_call'
  });
}

export async function flagRefrigerantComplianceIssue(
  tenantId: string,
  actorId: string,
  equipmentId: string
): Promise<boolean> {
  return runCrudOperation({
    configName: 'hvac-equipment-registry',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const equipment =
        getEquipment(
          tenantId,
          equipmentId
        );

      const refrigerant =
        equipment.refrigerantType
          .trim()
          .toUpperCase();

      return (
        refrigerant === '' ||
        refrigerant === 'UNKNOWN' ||
        refrigerant === 'R12'
      );
    },
    auditAction: 'data.read',
    auditResource: 'hvac_equipment',
    meterEventType: 'api_call'
  });
}
