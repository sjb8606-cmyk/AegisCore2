/**
 * platform/ag-field-registry (AG-01)
 *
 * GIS digital twin for farm fields: GeoJSON boundaries, PID/ARMS IDs,
 * WAWA 30m setback buffers, restricted zones.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('ag-field-registry');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  wawaBufferMeters: z.number().positive().default(30),
  maxFieldsPerTenant: z.number().int().positive().default(500),
});

export type ZoneType = 'wawa_buffer' | 'wetland' | 'watercourse' | 'other';

export interface GeoJsonPolygon {
  type: 'Polygon';
  coordinates: number[][][]; // [ [ [lon, lat], ... ] ]
}

export interface Field {
  id: string;
  tenantId: string;
  name: string;
  pidNumber: string | null;
  armsId: string | null;
  boundaryGeoJson: GeoJsonPolygon;
  acres: number;
  createdAt: string;
  updatedAt: string;
}

export interface RestrictedZone {
  id: string;
  tenantId: string;
  fieldId: string;
  zoneType: ZoneType;
  geometry: GeoJsonPolygon;
  reason: string;
  createdAt: string;
}

const fields = new Map<string, Field>();
const zones = new Map<string, RestrictedZone>();

export function __resetAgFieldRegistryStore(): void {
  fields.clear();
  zones.clear();
}

async function loadCfg() {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('ag-field-registry', ConfigSchema);
}

/** Bounding-box center of first ring (MVP; PostGIS replaces in prod) */
export function polygonCentroid(poly: GeoJsonPolygon): { lat: number; lon: number } {
  const ring = poly.coordinates[0] || [];
  if (!ring.length) return { lat: 0, lon: 0 };
  let sumLat = 0;
  let sumLon = 0;
  for (const [lon, lat] of ring) {
    sumLat += lat;
    sumLon += lon;
  }
  return { lat: sumLat / ring.length, lon: sumLon / ring.length };
}

/** Haversine km */
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
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * MVP WAWA setback: expand bbox of field by buffer meters ≈ degrees.
 * Production should use PostGIS ST_Buffer on geography.
 */
export function computeWawaSetbackPolygon(
  boundary: GeoJsonPolygon,
  bufferMeters: number,
): GeoJsonPolygon {
  const ring = boundary.coordinates[0] || [];
  if (ring.length < 3) {
    return { type: 'Polygon', coordinates: [[]] };
  }
  // \~111_320 m per degree latitude
  const deg = bufferMeters / 111_320;
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of ring) {
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  const expanded: number[][] = [
    [minLon - deg, minLat - deg],
    [maxLon + deg, minLat - deg],
    [maxLon + deg, maxLat + deg],
    [minLon - deg, maxLat + deg],
    [minLon - deg, minLat - deg],
  ];
  return { type: 'Polygon', coordinates: [expanded] };
}

function assertPolygon(g: unknown): GeoJsonPolygon {
  const p = g as GeoJsonPolygon;
  if (!p || p.type !== 'Polygon' || !Array.isArray(p.coordinates)) {
    throw new AppError('boundaryGeoJson must be a GeoJSON Polygon', ErrorCode.BAD_REQUEST);
  }
  if (!p.coordinates[0] || p.coordinates[0].length < 4) {
    throw new AppError('Polygon ring needs >= 4 positions', ErrorCode.BAD_REQUEST);
  }
  return p;
}

export async function registerField(
  tenantId: string,
  actorId: string,
  input: {
    name: string;
    pidNumber?: string;
    armsId?: string;
    boundaryGeoJson: GeoJsonPolygon;
    acres: number;
  },
): Promise<Field> {
  return runCrudOperation({
    configName: 'ag-field-registry',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      if (!input.name?.trim()) {
        throw new AppError('name is required', ErrorCode.BAD_REQUEST);
      }
      if (typeof input.acres !== 'number' || input.acres <= 0) {
        throw new AppError('acres must be positive', ErrorCode.BAD_REQUEST);
      }
      const boundary = assertPolygon(input.boundaryGeoJson);
      const count = [...fields.values()].filter((f) => f.tenantId === tenantId).length;
      if (count >= config.maxFieldsPerTenant) {
        throw new AppError('Field limit reached', ErrorCode.FORBIDDEN);
      }
      const now = new Date().toISOString();
      const field: Field = {
        id: crypto.randomUUID(),
        tenantId,
        name: input.name.trim(),
        pidNumber: input.pidNumber?.trim() || null,
        armsId: input.armsId?.trim() || null,
        boundaryGeoJson: boundary,
        acres: input.acres,
        createdAt: now,
        updatedAt: now,
      };
      fields.set(field.id, field);
      logger.info({ fieldId: field.id, name: field.name }, 'Field registered');
      return field;
    },
    auditAction: 'data.created',
    auditResource: 'ag_field',
    meterEventType: 'api_call',
  });
}

export async function calculateWawaSetback(
  tenantId: string,
  fieldId: string,
): Promise<{ fieldId: string; bufferMeters: number; setbackGeoJson: GeoJsonPolygon }> {
  const config = await loadCfg();
  const field = fields.get(fieldId);
  if (!field || field.tenantId !== tenantId) {
    throw new AppError('Field not found', ErrorCode.NOT_FOUND);
  }
  const setbackGeoJson = computeWawaSetbackPolygon(
    field.boundaryGeoJson,
    config.wawaBufferMeters,
  );
  return {
    fieldId,
    bufferMeters: config.wawaBufferMeters,
    setbackGeoJson,
  };
}

export async function flagRestrictedZone(
  tenantId: string,
  actorId: string,
  input: {
    fieldId: string;
    zoneType: ZoneType;
    geometry: GeoJsonPolygon;
    reason: string;
  },
): Promise<RestrictedZone> {
  return runCrudOperation({
    configName: 'ag-field-registry',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const field = fields.get(input.fieldId);
      if (!field || field.tenantId !== tenantId) {
        throw new AppError('Field not found', ErrorCode.NOT_FOUND);
      }
      const geometry = assertPolygon(input.geometry);
      if (!input.reason?.trim()) {
        throw new AppError('reason is required', ErrorCode.BAD_REQUEST);
      }
      const allowed: ZoneType[] = ['wawa_buffer', 'wetland', 'watercourse', 'other'];
      if (!allowed.includes(input.zoneType)) {
        throw new AppError('invalid zoneType', ErrorCode.BAD_REQUEST);
      }
      const zone: RestrictedZone = {
        id: crypto.randomUUID(),
        tenantId,
        fieldId: input.fieldId,
        zoneType: input.zoneType,
        geometry,
        reason: input.reason.trim(),
        createdAt: new Date().toISOString(),
      };
      zones.set(zone.id, zone);
      return zone;
    },
    auditAction: 'data.created',
    auditResource: 'ag_restricted_zone',
    meterEventType: 'api_call',
  });
}

export async function getRestrictedZones(
  tenantId: string,
  fieldId: string,
): Promise<RestrictedZone[]> {
  return [...zones.values()].filter(
    (z) => z.tenantId === tenantId && z.fieldId === fieldId,
  );
}

export async function getFieldsNearPoint(
  tenantId: string,
  lat: number,
  lng: number,
  radiusM: number,
): Promise<Array<Field & { distanceM: number }>> {
  if (typeof lat !== 'number' || typeof lng !== 'number' || radiusM <= 0) {
    throw new AppError('invalid lat/lng/radius', ErrorCode.BAD_REQUEST);
  }
  const radiusKm = radiusM / 1000;
  const out: Array<Field & { distanceM: number }> = [];
  for (const f of fields.values()) {
    if (f.tenantId !== tenantId) continue;
    const c = polygonCentroid(f.boundaryGeoJson);
    const dKm = haversineKm(lat, lng, c.lat, c.lon);
    if (dKm <= radiusKm) {
      out.push({ ...f, distanceM: Math.round(dKm * 1000) });
    }
  }
  out.sort((a, b) => a.distanceM - b.distanceM);
  return out;
}

export async function getField(
  tenantId: string,
  fieldId: string,
): Promise<Field | null> {
  const f = fields.get(fieldId);
  if (!f || f.tenantId !== tenantId) return null;
  return f;
}
