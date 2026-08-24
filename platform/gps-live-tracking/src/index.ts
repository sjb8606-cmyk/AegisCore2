import * as crypto from 'crypto';
import { z } from 'zod';
import {
  AppError,
  ErrorCode,
  runCrudOperation
} from '@platform/crud-kernel';

export const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  trackingLinkBaseUrl: z.string().url().default('https://tracking.example.com')
});

const TrackingSchema = z.object({
  trackingId: z.string().uuid(),
  tenantId: z.string().uuid(),
  jobId: z.string().uuid(),
  driverId: z.string().uuid(),
  currentLat: z.number().min(-90).max(90),
  currentLng: z.number().min(-180).max(180),
  lastUpdated: z.string().datetime(),
  etaMinutesRemaining: z.number().int().nonnegative()
});

export type GpsTracking = z.infer<typeof TrackingSchema>;

const trackingStore = new Map<string, GpsTracking>();

export function __resetGpsLiveTrackingStore(): void {
  trackingStore.clear();
}

function getTracking(
  tenantId: string,
  trackingId: string
): GpsTracking {
  const tracking = trackingStore.get(trackingId);

  if (!tracking) {
    throw new AppError(
      'Tracking record not found',
      ErrorCode.NOT_FOUND
    );
  }

  if (tracking.tenantId !== tenantId) {
    throw new AppError(
      'Resource does not belong to tenant',
      ErrorCode.FORBIDDEN
    );
  }

  return tracking;
}

function findTrackingForDriver(
  tenantId: string,
  driverId: string
): GpsTracking | undefined {
  return Array.from(trackingStore.values()).find(
    tracking =>
      tracking.tenantId === tenantId &&
      tracking.driverId === driverId
  );
}

export async function createTracking(
  tenantId: string,
  actorId: string,
  jobId: string,
  driverId: string,
  currentLat: number,
  currentLng: number,
  etaMinutesRemaining = 0
): Promise<GpsTracking> {
  return runCrudOperation({
    configName: 'gps-live-tracking',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (
        !z.string().uuid().safeParse(jobId).success ||
        !z.string().uuid().safeParse(driverId).success
      ) {
        throw new AppError(
          'Invalid job or driver ID',
          ErrorCode.BAD_REQUEST
        );
      }

      const existing = Array.from(trackingStore.values()).find(
        tracking =>
          tracking.tenantId === tenantId &&
          tracking.jobId === jobId
      );

      if (existing) {
        throw new AppError(
          'Tracking already exists for this job',
          ErrorCode.CONFLICT
        );
      }

      const tracking = TrackingSchema.parse({
        trackingId: crypto.randomUUID(),
        tenantId,
        jobId,
        driverId,
        currentLat,
        currentLng,
        lastUpdated: new Date().toISOString(),
        etaMinutesRemaining
      });

      trackingStore.set(
        tracking.trackingId,
        tracking
      );

      return tracking;
    },
    auditAction: 'data.created',
    auditResource: 'gps_live_tracking',
    meterEventType: 'api_call'
  });
}

export async function updateLocation(
  tenantId: string,
  actorId: string,
  driverId: string,
  lat: number,
  lng: number
): Promise<GpsTracking> {
  return runCrudOperation({
    configName: 'gps-live-tracking',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (
        !z.number().min(-90).max(90).safeParse(lat).success ||
        !z.number().min(-180).max(180).safeParse(lng).success
      ) {
        throw new AppError(
          'Invalid GPS coordinates',
          ErrorCode.BAD_REQUEST
        );
      }

      const tracking = findTrackingForDriver(
        tenantId,
        driverId
      );

      if (!tracking) {
        throw new AppError(
          'Active tracking record not found',
          ErrorCode.NOT_FOUND
        );
      }

      tracking.currentLat = lat;
      tracking.currentLng = lng;
      tracking.lastUpdated = new Date().toISOString();

      trackingStore.set(
        tracking.trackingId,
        tracking
      );

      return tracking;
    },
    auditAction: 'data.updated',
    auditResource: 'gps_live_tracking',
    meterEventType: 'api_call'
  });
}

export async function recalculateEta(
  tenantId: string,
  actorId: string,
  trackingId: string,
  etaMinutesRemaining: number
): Promise<GpsTracking> {
  return runCrudOperation({
    configName: 'gps-live-tracking',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (
        !Number.isInteger(etaMinutesRemaining) ||
        etaMinutesRemaining < 0
      ) {
        throw new AppError(
          'ETA must be a non-negative integer',
          ErrorCode.BAD_REQUEST
        );
      }

      const tracking = getTracking(
        tenantId,
        trackingId
      );

      tracking.etaMinutesRemaining =
        etaMinutesRemaining;
      tracking.lastUpdated =
        new Date().toISOString();

      trackingStore.set(
        tracking.trackingId,
        tracking
      );

      return tracking;
    },
    auditAction: 'data.updated',
    auditResource: 'gps_live_tracking',
    meterEventType: 'api_call'
  });
}

export async function getCustomerTrackingLink(
  tenantId: string,
  actorId: string,
  jobId: string
): Promise<string> {
  return runCrudOperation({
    configName: 'gps-live-tracking',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const tracking = Array.from(
        trackingStore.values()
      ).find(
        item =>
          item.tenantId === tenantId &&
          item.jobId === jobId
      );

      if (!tracking) {
        throw new AppError(
          'Tracking record not found',
          ErrorCode.NOT_FOUND
        );
      }

      const config = ConfigSchema.parse({});

      return (
        config.trackingLinkBaseUrl +
        '/track/' +
        tracking.trackingId
      );
    },
    auditAction: 'data.read',
    auditResource: 'gps_live_tracking',
    meterEventType: 'api_call'
  });
}
