import * as crypto from 'crypto';
import {
  runCrudOperation,
  AppError,
  ErrorCode
} from '@platform/crud-kernel';

export type EngineHourRecord = {
  assetId: string;
  reservationId: string;
  hoursAtPickup: number;
  hoursAtReturn?: number;
  includedHours: number;
  overageRatePerHour: number;
  maintenanceDueAtHours: number;
  createdAt: string;
  updatedAt: string;
};

const records = new Map<string, EngineHourRecord>();

const ConfigSchema = {
  safeParse(value: unknown) {
    if (!value || typeof value !== 'object') {
      return {
        success: false,
        error: new Error('Invalid configuration')
      };
    }

    return {
      success: true,
      data: value
    };
  }
};

const makeId = () => crypto.randomUUID();

function assertNonNegativeNumber(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new AppError(
      ErrorCode.BAD_REQUEST,
      field + ' must be a non-negative number'
    );
  }
}

function getByReservation(reservationId: string): EngineHourRecord | undefined {
  for (const record of records.values()) {
    if (record.reservationId === reservationId) {
      return record;
    }
  }

  return undefined;
}

export async function logHours(
  tenantId: string,
  actorId: string,
  assetId: string,
  reservationId: string,
  hoursAtPickup: number,
  hoursAtReturn: number,
  includedHours: number,
  overageRatePerHour: number,
  maintenanceDueAtHours: number
): Promise<EngineHourRecord> {
  assertNonNegativeNumber(hoursAtPickup, 'hoursAtPickup');
  assertNonNegativeNumber(hoursAtReturn, 'hoursAtReturn');
  assertNonNegativeNumber(includedHours, 'includedHours');
  assertNonNegativeNumber(overageRatePerHour, 'overageRatePerHour');
  assertNonNegativeNumber(maintenanceDueAtHours, 'maintenanceDueAtHours');

  if (hoursAtReturn < hoursAtPickup) {
    throw new AppError(
      ErrorCode.BAD_REQUEST,
      'hoursAtReturn cannot be less than hoursAtPickup'
    );
  }

  const existing = getByReservation(reservationId);

  const record: EngineHourRecord = {
    assetId,
    reservationId,
    hoursAtPickup: existing?.hoursAtPickup ?? hoursAtPickup,
    hoursAtReturn,
    includedHours,
    overageRatePerHour,
    maintenanceDueAtHours,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const result = await runCrudOperation({
    configName: 'engine-hour-usage-tracking',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: existing ? 'update' : 'create',
    auditAction: existing ? 'data.updated' : 'data.created',
    auditResource: 'engine-hour-usage-tracking',
    meterEventType: 'api_call',
    actionFn: async () => {
      records.set(reservationId, record);
      return record;
    }
  });

  return result;
}

export async function calculateOverage(
  tenantId: string,
  actorId: string,
  reservationId: string
): Promise<number> {
  const record = getByReservation(reservationId);

  if (!record) {
    throw new AppError(
      ErrorCode.NOT_FOUND,
      'Engine-hour record not found'
    );
  }

  const result = await runCrudOperation({
    configName: 'engine-hour-usage-tracking',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: 'read',
    auditAction: 'data.read',
    auditResource: 'engine-hour-usage-tracking',
    meterEventType: 'api_call',
    actionFn: async () => {
      const returned = record.hoursAtReturn ?? record.hoursAtPickup;
      const usedHours = Math.max(0, returned - record.hoursAtPickup);
      const overageHours = Math.max(0, usedHours - record.includedHours);

      return overageHours * record.overageRatePerHour;
    }
  });

  return result;
}

export async function flagMaintenanceDue(
  tenantId: string,
  actorId: string,
  assetId: string
): Promise<boolean> {
  const record = Array.from(records.values()).find(
    (item) => item.assetId === assetId
  );

  if (!record) {
    throw new AppError(
      ErrorCode.NOT_FOUND,
      'Engine-hour record not found'
    );
  }

  const result = await runCrudOperation({
    configName: 'engine-hour-usage-tracking',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: 'read',
    auditAction: 'data.read',
    auditResource: 'engine-hour-usage-tracking',
    meterEventType: 'api_call',
    actionFn: async () => {
      const currentHours =
        record.hoursAtReturn ?? record.hoursAtPickup;

      return currentHours >= record.maintenanceDueAtHours;
    }
  });

  return result;
}

export function __resetEngineHourUsageStore(): void {
  records.clear();
}
