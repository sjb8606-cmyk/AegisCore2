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

const ApplicationSchema = z.object({
  applicationId: z.string().uuid(),
  tenantId: z.string().uuid(),
  visitId: z.string().uuid(),
  propertyId: z.string().uuid(),
  materialType: z.enum([
    'salt',
    'brine',
    'sand',
    'calcium_chloride'
  ]),
  quantityApplied: z.number().positive(),
  gpsLat: z.number().min(-90).max(90),
  gpsLng: z.number().min(-180).max(180),
  timestamp: z.string().datetime()
});

export type SaltBrineApplication =
  z.infer<typeof ApplicationSchema>;

const applicationStore =
  new Map<string, SaltBrineApplication>();

export function __resetSaltBrineApplicationLogStore(): void {
  applicationStore.clear();
}

export async function logApplication(
  tenantId: string,
  actorId: string,
  visitId: string,
  propertyId: string,
  materialType: SaltBrineApplication['materialType'],
  quantityApplied: number,
  gpsLat: number,
  gpsLng: number
): Promise<SaltBrineApplication> {
  return runCrudOperation({
    configName: 'salt-brine-application-log',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (
        !Number.isFinite(quantityApplied) ||
        quantityApplied <= 0
      ) {
        throw new AppError(
          'Quantity applied must be greater than zero',
          ErrorCode.BAD_REQUEST
        );
      }

      if (
        !Number.isFinite(gpsLat) ||
        gpsLat < -90 ||
        gpsLat > 90 ||
        !Number.isFinite(gpsLng) ||
        gpsLng < -180 ||
        gpsLng > 180
      ) {
        throw new AppError(
          'Invalid GPS coordinates',
          ErrorCode.BAD_REQUEST
        );
      }

      const application = ApplicationSchema.parse({
        applicationId: crypto.randomUUID(),
        tenantId,
        visitId,
        propertyId,
        materialType,
        quantityApplied,
        gpsLat,
        gpsLng,
        timestamp: new Date().toISOString()
      });

      applicationStore.set(
        application.applicationId,
        application
      );

      return application;
    },
    auditAction: 'data.created',
    auditResource: 'salt_brine_application',
    meterEventType: 'api_call'
  });
}

export async function getLiabilityDefenseRecord(
  tenantId: string,
  actorId: string,
  propertyId: string,
  startDate: string,
  endDate: string
): Promise<SaltBrineApplication[]> {
  return runCrudOperation({
    configName: 'salt-brine-application-log',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const start = new Date(startDate);
      const end = new Date(endDate);

      if (
        Number.isNaN(start.getTime()) ||
        Number.isNaN(end.getTime()) ||
        start > end
      ) {
        throw new AppError(
          'Invalid date range',
          ErrorCode.BAD_REQUEST
        );
      }

      return Array.from(applicationStore.values())
        .filter((application) => {
          const timestamp =
            new Date(application.timestamp);

          return (
            application.tenantId === tenantId &&
            application.propertyId === propertyId &&
            timestamp >= start &&
            timestamp <= end
          );
        })
        .sort((a, b) =>
          a.timestamp.localeCompare(b.timestamp)
        );
    },
    auditAction: 'data.read',
    auditResource: 'salt_brine_application',
    meterEventType: 'api_call'
  });
}
