import * as crypto from 'crypto';
import { z } from 'zod';
import {
  AppError,
  ErrorCode,
  runCrudOperation
} from '@platform/crud-kernel';

export const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  allowedMeasurementTypes: z.array(
    z.enum([
      'lawn',
      'driveway',
      'siding',
      'deck',
      'other'
    ])
  ).default([
    'lawn',
    'driveway',
    'siding',
    'deck',
    'other'
  ]),
  allowedSources: z.array(
    z.enum([
      'manual',
      'satellite_estimate',
      'on_site_measured'
    ])
  ).default([
    'manual',
    'satellite_estimate',
    'on_site_measured'
  ])
});

export const PropertyMeasurementSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  propertyId: z.string().uuid(),
  clientId: z.string().uuid(),
  measurementType: z.enum([
    'lawn',
    'driveway',
    'siding',
    'deck',
    'other'
  ]),
  areaSqft: z.number().positive(),
  source: z.enum([
    'manual',
    'satellite_estimate',
    'on_site_measured'
  ]),
  lastUpdated: z.coerce.date()
});

export type PropertyMeasurement = z.infer<
  typeof PropertyMeasurementSchema
>;

const measurementStore = new Map<
  string,
  PropertyMeasurement
>();

export function __resetPropertyMeasurementStore(): void {
  measurementStore.clear();
}

function assertTenant(
  tenantId: string,
  measurement: PropertyMeasurement
): void {
  if (measurement.tenantId !== tenantId) {
    throw new AppError(
      'Resource does not belong to tenant',
      ErrorCode.FORBIDDEN
    );
  }
}

export async function addMeasurement(
  tenantId: string,
  actorId: string,
  propertyId: string,
  type: PropertyMeasurement['measurementType'],
  areaSqft: number,
  source: PropertyMeasurement['source'],
  clientId: string
): Promise<PropertyMeasurement> {
  return runCrudOperation({
    configName: 'property-measurement',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = ConfigSchema.parse({
        enabled: true
      });

      if (
        !config.allowedMeasurementTypes.includes(type)
      ) {
        throw new AppError(
          'Measurement type is not enabled',
          ErrorCode.BAD_REQUEST
        );
      }

      if (!config.allowedSources.includes(source)) {
        throw new AppError(
          'Measurement source is not enabled',
          ErrorCode.BAD_REQUEST
        );
      }

      if (
        !z.string().uuid().safeParse(propertyId).success ||
        !z.string().uuid().safeParse(clientId).success
      ) {
        throw new AppError(
          'Invalid property or client ID',
          ErrorCode.BAD_REQUEST
        );
      }

      if (!Number.isFinite(areaSqft) || areaSqft <= 0) {
        throw new AppError(
          'Area must be greater than zero',
          ErrorCode.BAD_REQUEST
        );
      }

      const measurement =
        PropertyMeasurementSchema.parse({
          id: crypto.randomUUID(),
          tenantId,
          propertyId,
          clientId,
          measurementType: type,
          areaSqft,
          source,
          lastUpdated: new Date()
        });

      measurementStore.set(
        measurement.id,
        measurement
      );

      return measurement;
    },
    auditAction: 'data.created',
    auditResource: 'property_measurement',
    meterEventType: 'api_call'
  });
}

export async function getMeasurements(
  tenantId: string,
  actorId: string,
  propertyId: string
): Promise<PropertyMeasurement[]> {
  return runCrudOperation({
    configName: 'property-measurement',
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

      return Array.from(
        measurementStore.values()
      ).filter(
        measurement =>
          measurement.tenantId === tenantId &&
          measurement.propertyId === propertyId
      );
    },
    auditAction: 'data.read',
    auditResource: 'property_measurement',
    meterEventType: 'api_call'
  });
}

export async function estimateFromSatellite(
  tenantId: string,
  actorId: string,
  address: string
): Promise<number> {
  return runCrudOperation({
    configName: 'property-measurement',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!address.trim()) {
        throw new AppError(
          'Address is required',
          ErrorCode.BAD_REQUEST
        );
      }

      /*
       * Integration hook only. No external satellite provider is
       * hardcoded into this core. A real adapter can be injected
       * by the application layer when available.
       */
      void tenantId;

      throw new AppError(
        'Satellite measurement integration is not configured',
        ErrorCode.NOT_FOUND
      );
    },
    auditAction: 'data.read',
    auditResource: 'property_measurement',
    meterEventType: 'api_call'
  });
}

export function getPropertyMeasurement(
  tenantId: string,
  measurementId: string
): PropertyMeasurement {
  const measurement =
    measurementStore.get(measurementId);

  if (!measurement) {
    throw new AppError(
      'Property measurement not found',
      ErrorCode.NOT_FOUND
    );
  }

  assertTenant(tenantId, measurement);

  return measurement;
}
