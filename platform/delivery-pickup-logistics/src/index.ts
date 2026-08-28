import * as crypto from 'crypto';
import { z } from 'zod';
import {
  runCrudOperation,
  AppError,
  ErrorCode,
} from '@platform/crud-kernel';

export type LogisticsStatus = 'scheduled' | 'delivered' | 'picked_up';

export type LogisticsRecord = {
  logisticsId: string;
  reservationId: string;
  deliveryAddress: string;
  deliveryDate: string;
  pickupDate?: string;
  transportFee: number;
  status: LogisticsStatus;
  createdAt: string;
  updatedAt: string;
};

const store = new Map<string, LogisticsRecord>();

export const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  limits: z
    .object({
      apiCallsPerMonth: z.number().default(10000),
    })
    .default({ apiCallsPerMonth: 10000 }),
  features: z
    .object({
      deliveryScheduling: z.boolean().default(true),
      pickupScheduling: z.boolean().default(true),
      transportFeeCalculation: z.boolean().default(true),
    })
    .default({
      deliveryScheduling: true,
      pickupScheduling: true,
      transportFeeCalculation: true,
    }),
});

function validateDate(value: string, field: string): void {
  if (Number.isNaN(Date.parse(value))) {
    throw new AppError(
      `${field} must be a valid date`,
      ErrorCode.BAD_REQUEST,
    );
  }
}

function validateFee(value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new AppError(
      'transportFee must be a non-negative number',
      ErrorCode.BAD_REQUEST,
    );
  }
}

export async function scheduleDelivery(
  tenantId: string,
  actorId: string,
  reservationId: string,
  address: string,
  date: string,
  transportFee: number = 0,
): Promise<LogisticsRecord> {
  if (!address.trim()) {
    throw new AppError(
      'deliveryAddress is required',
      ErrorCode.BAD_REQUEST,
    );
  }

  validateDate(date, 'deliveryDate');
  validateFee(transportFee);

  const existing = store.get(reservationId);

  const record: LogisticsRecord = {
    logisticsId: existing?.logisticsId ?? crypto.randomUUID(),
    reservationId,
    deliveryAddress: address,
    deliveryDate: date,
    pickupDate: existing?.pickupDate,
    transportFee,
    status: existing?.status ?? 'scheduled',
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return runCrudOperation({
    configName: 'delivery-pickup-logistics',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    auditAction: existing ? 'data.updated' : 'data.created',
    auditResource: 'delivery-pickup-logistics',
    meterEventType: 'api_call',
    action: async () => {
      store.set(reservationId, record);
      return record;
    },
  });
}

export async function schedulePickup(
  tenantId: string,
  actorId: string,
  reservationId: string,
  date: string,
): Promise<LogisticsRecord> {
  validateDate(date, 'pickupDate');

  const existing = store.get(reservationId);

  if (!existing) {
    throw new AppError(
      'Logistics record not found',
      ErrorCode.NOT_FOUND,
    );
  }

  if (Date.parse(date) < Date.parse(existing.deliveryDate)) {
    throw new AppError(
      'pickupDate cannot be before deliveryDate',
      ErrorCode.BAD_REQUEST,
    );
  }

  const record: LogisticsRecord = {
    ...existing,
    pickupDate: date,
    updatedAt: new Date().toISOString(),
  };

  return runCrudOperation({
    configName: 'delivery-pickup-logistics',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    auditAction: 'data.updated',
    auditResource: 'delivery-pickup-logistics',
    meterEventType: 'api_call',
    action: async () => {
      store.set(reservationId, record);
      return record;
    },
  });
}

export async function calculateTransportFee(
  tenantId: string,
  actorId: string,
  distance: number,
  ratePerMile: number = 2,
): Promise<number> {
  if (!Number.isFinite(distance) || distance < 0) {
    throw new AppError(
      'distance must be a non-negative number',
      ErrorCode.BAD_REQUEST,
    );
  }

  if (!Number.isFinite(ratePerMile) || ratePerMile < 0) {
    throw new AppError(
      'ratePerMile must be a non-negative number',
      ErrorCode.BAD_REQUEST,
    );
  }

  return runCrudOperation({
    configName: 'delivery-pickup-logistics',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    auditAction: 'data.read',
    auditResource: 'delivery-pickup-logistics',
    meterEventType: 'api_call',
    action: async () => Number((distance * ratePerMile).toFixed(2)),
  });
}

export async function markDelivered(
  tenantId: string,
  actorId: string,
  reservationId: string,
): Promise<LogisticsRecord> {
  const existing = store.get(reservationId);

  if (!existing) {
    throw new AppError(
      'Logistics record not found',
      ErrorCode.NOT_FOUND,
    );
  }

  const record: LogisticsRecord = {
    ...existing,
    status: 'delivered',
    updatedAt: new Date().toISOString(),
  };

  return runCrudOperation({
    configName: 'delivery-pickup-logistics',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    auditAction: 'data.updated',
    auditResource: 'delivery-pickup-logistics',
    meterEventType: 'api_call',
    action: async () => {
      store.set(reservationId, record);
      return record;
    },
  });
}

export async function markPickedUp(
  tenantId: string,
  actorId: string,
  reservationId: string,
): Promise<LogisticsRecord> {
  const existing = store.get(reservationId);

  if (!existing) {
    throw new AppError(
      'Logistics record not found',
      ErrorCode.NOT_FOUND,
    );
  }

  const record: LogisticsRecord = {
    ...existing,
    status: 'picked_up',
    updatedAt: new Date().toISOString(),
  };

  return runCrudOperation({
    configName: 'delivery-pickup-logistics',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    auditAction: 'data.updated',
    auditResource: 'delivery-pickup-logistics',
    meterEventType: 'api_call',
    action: async () => {
      store.set(reservationId, record);
      return record;
    },
  });
}

export function __resetDeliveryPickupLogisticsStore(): void {
  store.clear();
}
