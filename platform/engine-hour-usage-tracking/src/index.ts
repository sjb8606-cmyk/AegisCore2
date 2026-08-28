import * as crypto from 'crypto';
import { z } from 'zod';
import {
  runCrudOperation,
  AppError,
  ErrorCode,
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

export const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  limits: z
    .object({
      apiCallsPerMonth: z.number().default(10000),
    })
    .default({ apiCallsPerMonth: 10000 }),
  features: z
    .object({
      overageTracking: z.boolean().default(true),
      maintenanceAlerts: z.boolean().default(true),
    })
    .default({
      overageTracking: true,
      maintenanceAlerts: true,
    }),
});

function assertNonNegativeNumber(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new AppError(
      `${field} must be a non-negative number`,
      ErrorCode.BAD_REQUEST,
    );
  }
}

function getByReservation(
  reservationId: string,
): EngineHourRecord | undefined {
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
  maintenanceDueAtHours: number,
): Promise<EngineHourRecord> {
  assertNonNegativeNumber(hoursAtPickup, 'hoursAtPickup');
  assertNonNegativeNumber(hoursAtReturn, 'hoursAtReturn');
  assertNonNegativeNumber(includedHours, 'includedHours');
  assertNonNegativeNumber(overageRatePerHour, 'overageRatePerHour');
  assertNonNegativeNumber(maintenanceDueAtHours, 'maintenanceDueAtHours');

  if (hoursAtReturn < hoursAtPickup) {
    throw new AppError(
      'hoursAtReturn cannot be less than hoursAtPickup',
      ErrorCode.BAD_REQUEST,
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
    updatedAt: new Date().toISOString(),
  };

  return runCrudOperation({
    configName: 'engine-hour-usage-tracking',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    auditAction: existing ? 'data.updated' : 'data.created',
    auditResource: 'engine-hour-usage-tracking',
    meterEventType: 'api_call',
    action: async () => {
      records.set(reservationId, record);
      return record;
    },
  });
}

export async function calculateOverage(
  tenantId: string,
  actorId: string,
  reservationId: string,
): Promise<number> {
  const record = getByReservation(reservationId);

  if (!record) {
    throw new AppError(
      'Engine-hour record not found',
      ErrorCode.NOT_FOUND,
    );
  }

  return runCrudOperation({
    configName: 'engine-hour-usage-tracking',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    auditAction: 'data.read',
    auditResource: 'engine-hour-usage-tracking',
    meterEventType: 'api_call',
    action: async () => {
      const returned = record.hoursAtReturn ?? record.hoursAtPickup;
      const usedHours = Math.max(0, returned - record.hoursAtPickup);
      const overageHours = Math.max(0, usedHours - record.includedHours);
      return overageHours * record.overageRatePerHour;
    },
  });
}

export async function flagMaintenanceDue(
  tenantId: string,
  actorId: string,
  assetId: string,
): Promise<boolean> {
  const record = Array.from(records.values()).find(
    (item) => item.assetId === assetId,
  );

  if (!record) {
    throw new AppError(
      'Engine-hour record not found',
      ErrorCode.NOT_FOUND,
    );
  }

  return runCrudOperation({
    configName: 'engine-hour-usage-tracking',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    auditAction: 'data.read',
    auditResource: 'engine-hour-usage-tracking',
    meterEventType: 'api_call',
    action: async () => {
      const currentHours = record.hoursAtReturn ?? record.hoursAtPickup;
      return currentHours >= record.maintenanceDueAtHours;
    },
  });
}

export function __resetEngineHourUsageStore(): void {
  records.clear();
}
