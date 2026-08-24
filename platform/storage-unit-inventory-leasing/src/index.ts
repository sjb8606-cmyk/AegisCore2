import * as crypto from 'crypto';
import { z } from 'zod';
import {
  runCrudOperation,
  AppError,
  ErrorCode
} from '@platform/crud-kernel';
import { loadConfig } from '@platform/utils';
import { getLogger } from '@platform/observability';

const logger = getLogger('storage-unit-inventory-leasing');

export const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  limits: z.object({
    units_per_tenant: z.number().int().positive().default(10000)
  }).default({
    units_per_tenant: 10000
  })
});

type UnitSize =
  | 'small'
  | 'medium'
  | 'large'
  | 'climate_controlled'
  | 'outdoor';

type UnitStatus =
  | 'available'
  | 'occupied'
  | 'reserved'
  | 'maintenance';

export interface StorageUnit {
  unit_id: string;
  tenant_id: string;
  facility_id: string;
  unit_size: UnitSize;
  monthly_rate: number;
  status: UnitStatus;
  tenant_id_holder?: string;
  lease_start_date?: string;
  lease_end_date?: string;
  created_at: string;
  updated_at: string;
}

const unitStore = new Map<string, StorageUnit>();

export function __resetStorageUnitInventoryLeasingStore(): void {
  unitStore.clear();
}

function getConfig() {
  return loadConfig('storage-unit-inventory-leasing', ConfigSchema);
}

export async function getAvailableUnits(
  tenantId: string,
  facilityId: string,
  sizeFilter?: UnitSize
): Promise<StorageUnit[]> {
  const config = getConfig();

  if (!config.enabled) {
    return [];
  }

  return Array.from(unitStore.values()).filter((unit) => {
    if (unit.tenant_id !== tenantId) return false;
    if (unit.facility_id !== facilityId) return false;
    if (unit.status !== 'available') return false;
    if (sizeFilter && unit.unit_size !== sizeFilter) return false;
    return true;
  });
}

export async function createLease(
  tenantId: string,
  actorId: string,
  unitId: string,
  leaseTenantId: string,
  startDate: string
): Promise<StorageUnit> {
  return runCrudOperation({
    configName: 'storage-unit-inventory-leasing',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const unit = unitStore.get(unitId);

      if (!unit || unit.tenant_id !== tenantId) {
        throw new AppError(
          ErrorCode.NOT_FOUND,
          'Storage unit not found'
        );
      }

      if (unit.status !== 'available') {
        throw new AppError(
          ErrorCode.CONFLICT,
          'Storage unit is not available'
        );
      }

      const now = new Date().toISOString();

      const updated: StorageUnit = {
        ...unit,
        status: 'occupied',
        tenant_id_holder: leaseTenantId,
        lease_start_date: startDate,
        updated_at: now
      };

      unitStore.set(unitId, updated);

      logger.info('Storage unit lease created', {
        tenantId,
        unitId,
        leaseTenantId
      });

      return updated;
    },
    auditAction: 'data.updated',
    auditResource: 'storage_unit',
    meterEventType: 'api_call'
  });
}

export async function endLease(
  tenantId: string,
  actorId: string,
  unitId: string,
  endDate: string
): Promise<StorageUnit> {
  return runCrudOperation({
    configName: 'storage-unit-inventory-leasing',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const unit = unitStore.get(unitId);

      if (!unit || unit.tenant_id !== tenantId) {
        throw new AppError(
          ErrorCode.NOT_FOUND,
          'Storage unit not found'
        );
      }

      if (unit.status !== 'occupied') {
        throw new AppError(
          ErrorCode.CONFLICT,
          'Storage unit does not have an active lease'
        );
      }

      const updated: StorageUnit = {
        ...unit,
        status: 'available',
        tenant_id_holder: undefined,
        lease_start_date: undefined,
        lease_end_date: endDate,
        updated_at: new Date().toISOString()
      };

      unitStore.set(unitId, updated);

      return updated;
    },
    auditAction: 'data.updated',
    auditResource: 'storage_unit',
    meterEventType: 'api_call'
  });
}

export async function registerStorageUnit(
  tenantId: string,
  actorId: string,
  facilityId: string,
  unitSize: UnitSize,
  monthlyRate: number
): Promise<StorageUnit> {
  return runCrudOperation({
    configName: 'storage-unit-inventory-leasing',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (monthlyRate < 0) {
        throw new AppError(
          ErrorCode.BAD_REQUEST,
          'Monthly rate cannot be negative'
        );
      }

      const unitId = crypto.randomUUID();
      const now = new Date().toISOString();

      const unit: StorageUnit = {
        unit_id: unitId,
        tenant_id: tenantId,
        facility_id: facilityId,
        unit_size: unitSize,
        monthly_rate: monthlyRate,
        status: 'available',
        created_at: now,
        updated_at: now
      };

      unitStore.set(unitId, unit);

      return unit;
    },
    auditAction: 'data.created',
    auditResource: 'storage_unit',
    meterEventType: 'api_call'
  });
}

export async function getUnit(
  tenantId: string,
  unitId: string
): Promise<StorageUnit> {
  const unit = unitStore.get(unitId);

  if (!unit || unit.tenant_id !== tenantId) {
    throw new AppError(
      ErrorCode.NOT_FOUND,
      'Storage unit not found'
    );
  }

  return unit;
}
