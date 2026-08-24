import * as crypto from 'crypto';
import { z } from 'zod';
import {
  AppError,
  ErrorCode,
  runCrudOperation
} from '@platform/crud-kernel';

export const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  defaultEtaMinutes: z.number().int().positive().default(60)
});

const UrgencySchema = z.enum([
  'scheduled',
  'same_day',
  'emergency'
]);

const StatusSchema = z.enum([
  'pending',
  'assigned',
  'en_route',
  'arrived',
  'completed',
  'cancelled'
]);

const RequestSchema = z.object({
  requestId: z.string().uuid(),
  tenantId: z.string().uuid(),
  clientId: z.string().uuid(),
  location: z.string().min(1).max(1000),
  urgency: UrgencySchema,
  requestedAt: z.coerce.date(),
  estimatedArrival: z.coerce.date().nullable(),
  status: StatusSchema,
  driverId: z.string().uuid().nullable()
});

export type OnDemandDispatchRequest =
  z.infer<typeof RequestSchema>;

export type DispatchUrgency =
  z.infer<typeof UrgencySchema>;

export type DispatchStatus =
  z.infer<typeof StatusSchema>;

const requestStore =
  new Map<string, OnDemandDispatchRequest>();

export function __resetOnDemandDispatchRequestStore(): void {
  requestStore.clear();
}

function getRequest(
  tenantId: string,
  requestId: string
): OnDemandDispatchRequest {
  const request = requestStore.get(requestId);

  if (!request) {
    throw new AppError(
      'Dispatch request not found',
      ErrorCode.NOT_FOUND
    );
  }

  if (request.tenantId !== tenantId) {
    throw new AppError(
      'Resource does not belong to tenant',
      ErrorCode.FORBIDDEN
    );
  }

  return request;
}

export async function createRequest(
  tenantId: string,
  actorId: string,
  clientId: string,
  location: string,
  urgency: DispatchUrgency
): Promise<OnDemandDispatchRequest> {
  return runCrudOperation({
    configName: 'on-demand-dispatch-request',
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

      if (!location.trim()) {
        throw new AppError(
          'Location is required',
          ErrorCode.BAD_REQUEST
        );
      }

      const parsedUrgency =
        UrgencySchema.safeParse(urgency);

      if (!parsedUrgency.success) {
        throw new AppError(
          'Invalid dispatch urgency',
          ErrorCode.BAD_REQUEST
        );
      }

      const request =
        RequestSchema.parse({
          requestId: crypto.randomUUID(),
          tenantId,
          clientId,
          location: location.trim(),
          urgency: parsedUrgency.data,
          requestedAt: new Date(),
          estimatedArrival: null,
          status: 'pending',
          driverId: null
        });

      requestStore.set(
        request.requestId,
        request
      );

      return request;
    },
    auditAction: 'data.created',
    auditResource: 'on_demand_dispatch_request',
    meterEventType: 'api_call'
  });
}

export async function calculateEta(
  tenantId: string,
  actorId: string,
  location: string,
  availableDrivers: Array<{
    driverId: string;
    etaMinutes: number;
  }>
): Promise<number> {
  return runCrudOperation({
    configName: 'on-demand-dispatch-request',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!location.trim()) {
        throw new AppError(
          'Location is required',
          ErrorCode.BAD_REQUEST
        );
      }

      if (!Array.isArray(availableDrivers)) {
        throw new AppError(
          'Available drivers must be an array',
          ErrorCode.BAD_REQUEST
        );
      }

      const validEtas =
        availableDrivers
          .filter(
            driver =>
              z.string()
                .uuid()
                .safeParse(driver.driverId)
                .success &&
              Number.isFinite(driver.etaMinutes) &&
              driver.etaMinutes >= 0
          )
          .map(driver => driver.etaMinutes);

      if (validEtas.length === 0) {
        return ConfigSchema.parse({})
          .defaultEtaMinutes;
      }

      return Math.min(...validEtas);
    },
    auditAction: 'data.read',
    auditResource: 'on_demand_dispatch_request',
    meterEventType: 'api_call'
  });
}

export async function assignDriver(
  tenantId: string,
  actorId: string,
  requestId: string,
  driverId: string
): Promise<OnDemandDispatchRequest> {
  return runCrudOperation({
    configName: 'on-demand-dispatch-request',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const request =
        getRequest(tenantId, requestId);

      if (!z.string().uuid().safeParse(driverId).success) {
        throw new AppError(
          'Invalid driver ID',
          ErrorCode.BAD_REQUEST
        );
      }

      if (
        request.status === 'completed' ||
        request.status === 'cancelled'
      ) {
        throw new AppError(
          'Cannot assign a completed or cancelled request',
          ErrorCode.CONFLICT
        );
      }

      request.driverId = driverId;
      request.status = 'assigned';

      requestStore.set(
        request.requestId,
        request
      );

      return request;
    },
    auditAction: 'data.updated',
    auditResource: 'on_demand_dispatch_request',
    meterEventType: 'api_call'
  });
}

export async function updateStatus(
  tenantId: string,
  actorId: string,
  requestId: string,
  status: DispatchStatus
): Promise<OnDemandDispatchRequest> {
  return runCrudOperation({
    configName: 'on-demand-dispatch-request',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const request =
        getRequest(tenantId, requestId);

      const parsedStatus =
        StatusSchema.safeParse(status);

      if (!parsedStatus.success) {
        throw new AppError(
          'Invalid dispatch status',
          ErrorCode.BAD_REQUEST
        );
      }

      request.status = parsedStatus.data;

      requestStore.set(
        request.requestId,
        request
      );

      return request;
    },
    auditAction: 'data.updated',
    auditResource: 'on_demand_dispatch_request',
    meterEventType: 'api_call'
  });
}
