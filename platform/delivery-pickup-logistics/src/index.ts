import * as crypto from 'crypto';
import {
  runCrudOperation,
  AppError,
  ErrorCode
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

function validateDate(value: string, field: string): void {
  if (Number.isNaN(Date.parse(value))) {
    throw new AppError(
      ErrorCode.BAD_REQUEST,
      field + ' must be a valid date'
    );
  }
}

function validateFee(value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new AppError(
      ErrorCode.BAD_REQUEST,
      'transportFee must be a non-negative number'
    );
  }
}

export async function scheduleDelivery(
  tenantId: string,
  actorId: string,
  reservationId: string,
  address: string,
  date: string,
  transportFee: number = 0
): Promise<LogisticsRecord> {
  if (!address.trim()) {
    throw new AppError(
      ErrorCode.BAD_REQUEST,
      'deliveryAddress is required'
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
    updatedAt: new Date().toISOString()
  };

  return runCrudOperation({
    configName: 'delivery-pickup-logistics',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: existing ? 'update' : 'create',
    auditAction: existing ? 'data.updated' : 'data.created',
    auditResource: 'delivery-pickup-logistics',
    meterEventType: 'api_call',
    actionFn: async () => {
      store.set(reservationId, record);
      return record;
    }
  });
}

export async function schedulePickup(
  tenantId: string,
  actorId: string,
  reservationId: string,
  date: string
): Promise<LogisticsRecord> {
  validateDate(date, 'pickupDate');

  const existing = store.get(reservationId);

  if (!existing) {
    throw new AppError(
      ErrorCode.NOT_FOUND,
      'Logistics record not found'
    );
  }

  if (Date.parse(date) < Date.parse(existing.deliveryDate)) {
    throw new AppError(
      ErrorCode.BAD_REQUEST,
      'pickupDate cannot be before deliveryDate'
    );
  }

  const record: LogisticsRecord = {
    ...existing,
    pickupDate: date,
    updatedAt: new Date().toISOString()
  };

  return runCrudOperation({
    configName: 'delivery-pickup-logistics',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: 'update',
    auditAction: 'data.updated',
    auditResource: 'delivery-pickup-logistics',
    meterEventType: 'api_call',
    actionFn: async () => {
      store.set(reservationId, record);
      return record;
    }
  });
}

export async function calculateTransportFee(
  tenantId: string,
  actorId: string,
  distance: number,
  ratePerMile: number = 2
): Promise<number> {
  if (!Number.isFinite(distance) || distance < 0) {
    throw new AppError(
      ErrorCode.BAD_REQUEST,
      'distance must be a non-negative number'
    );
  }

  if (!Number.isFinite(ratePerMile) || ratePerMile < 0) {
    throw new AppError(
      ErrorCode.BAD_REQUEST,
      'ratePerMile must be a non-negative number'
    );
  }

  return runCrudOperation({
    configName: 'delivery-pickup-logistics',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: 'read',
    auditAction: 'data.read',
    auditResource: 'delivery-pickup-logistics',
    meterEventType: 'api_call',
    actionFn: async () => {
      return Number((distance * ratePerMile).toFixed(2));
    }
  });
}

export async function markDelivered(
  tenantId: string,
  actorId: string,
  reservationId: string
): Promise<LogisticsRecord> {
  const existing = store.get(reservationId);

  if (!existing) {
    throw new AppError(
      ErrorCode.NOT_FOUND,
      'Logistics record not found'
    );
  }

  const record: LogisticsRecord = {
    ...existing,
    status: 'delivered',
    updatedAt: new Date().toISOString()
  };

  return runCrudOperation({
    configName: 'delivery-pickup-logistics',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: 'update',
    auditAction: 'data.updated',
    auditResource: 'delivery-pickup-logistics',
    meterEventType: 'api_call',
    actionFn: async () => {
      store.set(reservationId, record);
      return record;
    }
  });
}

export async function markPickedUp(
  tenantId: string,
  actorId: string,
  reservationId: string
): Promise<LogisticsRecord> {
  const existing = store.get(reservationId);

  if (!existing) {
    throw new AppError(
      ErrorCode.NOT_FOUND,
      'Logistics record not found'
    );
  }

  const record: LogisticsRecord = {
    ...existing,
    status: 'picked_up',
    updatedAt: new Date().toISOString()
  };

  return runCrudOperation({
    configName: 'delivery-pickup-logistics',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: 'update',
    auditAction: 'data.updated',
    auditResource: 'delivery-pickup-logistics',
    meterEventType: 'api_call',
    actionFn: async () => {
      store.set(reservationId, record);
      return record;
    }
  });
}

export function __resetDeliveryPickupLogisticsStore(): void {
  store.clear();
}
