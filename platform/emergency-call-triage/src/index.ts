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

const SeveritySchema = z.enum([
  'minor_drip',
  'active_leak',
  'burst_pipe',
  'no_water',
  'sewage_backup'
]);

export type EmergencySeverity =
  z.infer<typeof SeveritySchema>;

export const EmergencyCallSchema = z.object({
  callId: z.string().uuid(),
  tenantId: z.string().uuid(),
  clientId: z.string().uuid(),
  propertyId: z.string().uuid(),
  severity: SeveritySchema,
  waterShutoffLocation: z.string().max(1000).nullable(),
  estimatedResponseTimeMinutes: z.number().int().nonnegative()
});

export type EmergencyCall =
  z.infer<typeof EmergencyCallSchema>;

const callStore = new Map<string, EmergencyCall>();

const shutoffStore = new Map<
  string,
  {
    tenantId: string;
    location: string;
  }
>();

export function __resetEmergencyCallTriageStore(): void {
  callStore.clear();
  shutoffStore.clear();
}

export function __setShutoffLocation(
  tenantId: string,
  propertyId: string,
  location: string
): void {
  shutoffStore.set(
    tenantId + ':' + propertyId,
    {
      tenantId,
      location
    }
  );
}

export function classifySeverity(
  description: string
): EmergencySeverity {
  const text = description.trim().toLowerCase();

  if (!text) {
    throw new AppError(
      'Emergency description is required',
      ErrorCode.BAD_REQUEST
    );
  }

  if (
    text.includes('sewage') ||
    text.includes('sewer backup') ||
    text.includes('sewage backup')
  ) {
    return 'sewage_backup';
  }

  if (
    text.includes('burst pipe') ||
    text.includes('pipe burst')
  ) {
    return 'burst_pipe';
  }

  if (
    text.includes('no water') ||
    text.includes('no running water')
  ) {
    return 'no_water';
  }

  if (
    text.includes('active leak') ||
    text.includes('water pouring') ||
    text.includes('flooding')
  ) {
    return 'active_leak';
  }

  return 'minor_drip';
}

function responseTimeFor(
  severity: EmergencySeverity
): number {
  switch (severity) {
    case 'sewage_backup':
    case 'burst_pipe':
      return 30;
    case 'active_leak':
      return 60;
    case 'no_water':
      return 120;
    case 'minor_drip':
      return 240;
  }
}

function getStoredCall(
  tenantId: string,
  callId: string
): EmergencyCall {
  const call = callStore.get(callId);

  if (!call) {
    throw new AppError(
      'Emergency call not found',
      ErrorCode.NOT_FOUND
    );
  }

  if (call.tenantId !== tenantId) {
    throw new AppError(
      'Resource does not belong to tenant',
      ErrorCode.FORBIDDEN
    );
  }

  return call;
}

export async function createEmergencyCall(
  tenantId: string,
  actorId: string,
  clientId: string,
  propertyId: string,
  description: string
): Promise<EmergencyCall> {
  return runCrudOperation({
    configName: 'emergency-call-triage',
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

      if (!z.string().uuid().safeParse(propertyId).success) {
        throw new AppError(
          'Invalid property ID',
          ErrorCode.BAD_REQUEST
        );
      }

      const severity = classifySeverity(description);

      const shutoff =
        shutoffStore.get(
          tenantId + ':' + propertyId
        );

      const call = EmergencyCallSchema.parse({
        callId: crypto.randomUUID(),
        tenantId,
        clientId,
        propertyId,
        severity,
        waterShutoffLocation:
          shutoff?.location ?? null,
        estimatedResponseTimeMinutes:
          responseTimeFor(severity)
      });

      callStore.set(call.callId, call);

      return call;
    },
    auditAction: 'data.created',
    auditResource: 'emergency_call',
    meterEventType: 'api_call'
  });
}

export async function getShutoffLocation(
  tenantId: string,
  actorId: string,
  propertyId: string
): Promise<string | null> {
  return runCrudOperation({
    configName: 'emergency-call-triage',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!z.string().uuid().safeParse(propertyId).success) {
        throw new AppError(
          'Invalid property ID',
          ErrorCode.BAD_REQUEST
        );
      }

      const record =
        shutoffStore.get(
          tenantId + ':' + propertyId
        );

      return record?.location ?? null;
    },
    auditAction: 'data.read',
    auditResource: 'emergency_call',
    meterEventType: 'api_call'
  });
}

export async function calculatePriorityDispatch(
  tenantId: string,
  actorId: string,
  severity: EmergencySeverity
): Promise<number> {
  return runCrudOperation({
    configName: 'emergency-call-triage',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const parsed =
        SeveritySchema.safeParse(severity);

      if (!parsed.success) {
        throw new AppError(
          'Invalid emergency severity',
          ErrorCode.BAD_REQUEST
        );
      }

      return responseTimeFor(parsed.data);
    },
    auditAction: 'data.read',
    auditResource: 'emergency_call',
    meterEventType: 'api_call'
  });
}

export async function getEmergencyCall(
  tenantId: string,
  actorId: string,
  callId: string
): Promise<EmergencyCall> {
  return runCrudOperation({
    configName: 'emergency-call-triage',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () =>
      getStoredCall(tenantId, callId),
    auditAction: 'data.read',
    auditResource: 'emergency_call',
    meterEventType: 'api_call'
  });
}
