/**
 * platform/geo-nearby
 *
 * Proximity search via Haversine (MVP). Postgres 2dsphere / PostGIS can replace
 * the index later without changing the public API.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('geo-nearby');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  indexedEntityTypes: z.array(z.string()).default(['*']),
  defaultRadiusKm: z.number().positive().default(25),
  maxRadiusKm: z.number().positive().default(500),
  maxResults: z.number().int().positive().default(50),
});

export interface LocationPoint {
  id: string;
  tenantId: string;
  entityType: string;
  entityId: string;
  lat: number;
  lon: number;
  metadata: Record<string, unknown>;
  updatedAt: string;
}

export interface NearbyResult {
  entityType: string;
  entityId: string;
  lat: number;
  lon: number;
  distanceKm: number;
  metadata: Record<string, unknown>;
}

const points = new Map<string, LocationPoint>(); // tenant:type:entityId

export function __resetGeoNearbyStore(): void {
  points.clear();
}

function pk(
  tenantId: string,
  entityType: string,
  entityId: string,
): string {
  return tenantId + ':' + entityType + ':' + entityId;
}

async function loadCfg() {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('geo-nearby', ConfigSchema);
}

/** Haversine distance in km */
export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 1000) / 1000;
}

function validCoord(lat: number, lon: number): boolean {
  return (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    !Number.isNaN(lat) &&
    !Number.isNaN(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

export async function upsertLocation(
  tenantId: string,
  actorId: string,
  input: {
    entityType: string;
    entityId: string;
    lat: number;
    lon: number;
    metadata?: Record<string, unknown>;
  },
): Promise<LocationPoint> {
  return runCrudOperation({
    configName: 'geo-nearby',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      if (!input.entityType || !input.entityId) {
        throw new AppError(
          'entityType and entityId required',
          ErrorCode.BAD_REQUEST,
        );
      }
      if (
        !config.indexedEntityTypes.includes('*') &&
        !config.indexedEntityTypes.includes(input.entityType)
      ) {
        throw new AppError(
          'entity type not geo-indexed',
          ErrorCode.FORBIDDEN,
        );
      }
      if (!validCoord(input.lat, input.lon)) {
        throw new AppError('invalid lat/lon', ErrorCode.BAD_REQUEST);
      }
      const key = pk(tenantId, input.entityType, input.entityId);
      const existing = points.get(key);
      const point: LocationPoint = {
        id: existing?.id || crypto.randomUUID(),
        tenantId,
        entityType: input.entityType,
        entityId: input.entityId,
        lat: input.lat,
        lon: input.lon,
        metadata: input.metadata || existing?.metadata || {},
        updatedAt: new Date().toISOString(),
      };
      points.set(key, point);
      return point;
    },
    auditAction: 'data.updated',
    auditResource: 'location_point',
    meterEventType: 'api_call',
  });
}

export async function nearby(
  tenantId: string,
  actorId: string,
  input: {
    lat: number;
    lon: number;
    radiusKm?: number;
    entityType?: string;
    limit?: number;
  },
): Promise<NearbyResult[]> {
  return runCrudOperation({
    configName: 'geo-nearby',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      if (!validCoord(input.lat, input.lon)) {
        throw new AppError('invalid lat/lon', ErrorCode.BAD_REQUEST);
      }
      const radius = Math.min(
        input.radiusKm ?? config.defaultRadiusKm,
        config.maxRadiusKm,
      );
      const limit = Math.min(input.limit ?? config.maxResults, config.maxResults);

      const results: NearbyResult[] = [];
      for (const p of points.values()) {
        if (p.tenantId !== tenantId) continue;
        if (input.entityType && p.entityType !== input.entityType) continue;
        const d = haversineKm(input.lat, input.lon, p.lat, p.lon);
        if (d <= radius) {
          results.push({
            entityType: p.entityType,
            entityId: p.entityId,
            lat: p.lat,
            lon: p.lon,
            distanceKm: d,
            metadata: p.metadata,
          });
        }
      }
      results.sort((a, b) => a.distanceKm - b.distanceKm);
      logger.info(
        { count: results.length, radius },
        'Nearby search',
      );
      return results.slice(0, limit);
    },
    auditAction: 'data.read',
    auditResource: 'location_point',
    meterEventType: 'api_call',
  });
}

export async function removeLocation(
  tenantId: string,
  actorId: string,
  entityType: string,
  entityId: string,
): Promise<{ removed: boolean }> {
  return runCrudOperation({
    configName: 'geo-nearby',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const key = pk(tenantId, entityType, entityId);
      const existed = points.delete(key);
      return { removed: existed };
    },
    auditAction: 'data.deleted',
    auditResource: 'location_point',
    meterEventType: 'api_call',
  });
}

export async function getLocation(
  tenantId: string,
  entityType: string,
  entityId: string,
): Promise<LocationPoint | null> {
  return points.get(pk(tenantId, entityType, entityId)) || null;
}
