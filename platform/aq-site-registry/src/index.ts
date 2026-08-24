/**
 * platform/aq-site-registry (AQ-01)
 *
 * Marine/shellfish site registry with lease/licence tenure, authorized
 * species/methods, GeoJSON boundaries, expiry alerts.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('aq-site-registry');

const TenureTypes = ['lease', 'occupation_permit'] as const;
const CultureMethods = [
  'net_pen',
  'longline',
  'floating_bag',
  'bottom_culture',
  'land_based',
] as const;

export type TenureType = (typeof TenureTypes)[number];
export type CultureMethod = (typeof CultureMethods)[number];

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  defaultExpiryWarningDays: z.number().int().positive().default(90),
  maxSitesPerTenant: z.number().int().positive().default(200),
});

export interface GeoJsonPolygon {
  type: 'Polygon';
  coordinates: number[][][];
}

export interface Site {
  id: string;
  tenantId: string;
  siteName: string;
  leaseNumber: string | null;
  licenceNumber: string | null;
  boundaryGeoJson: GeoJsonPolygon;
  areaHectares: number;
  speciesAuthorized: string[];
  cultureMethod: CultureMethod;
  tenureType: TenureType;
  expiryDate: string;
  createdAt: string;
}

const sites = new Map<string, Site>();

export function __resetAqSiteRegistryStore(): void {
  sites.clear();
}

async function loadCfg() {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('aq-site-registry', ConfigSchema);
}

function assertPolygon(g: unknown): GeoJsonPolygon {
  const p = g as GeoJsonPolygon;
  if (!p || p.type !== 'Polygon' || !Array.isArray(p.coordinates)) {
    throw new AppError(
      'boundaryGeoJson must be a GeoJSON Polygon',
      ErrorCode.BAD_REQUEST,
    );
  }
  if (!p.coordinates[0] || p.coordinates[0].length < 4) {
    throw new AppError('Polygon ring needs >= 4 positions', ErrorCode.BAD_REQUEST);
  }
  return p;
}

/** Simple point-in-ring (ray casting) for first polygon ring */
export function pointInPolygon(
  lon: number,
  lat: number,
  poly: GeoJsonPolygon,
): boolean {
  const ring = poly.coordinates[0] || [];
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi + 0.0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export async function registerSite(
  tenantId: string,
  actorId: string,
  input: {
    siteName: string;
    leaseNumber?: string;
    licenceNumber?: string;
    boundaryGeoJson: GeoJsonPolygon;
    areaHectares: number;
    speciesAuthorized: string[];
    cultureMethod: CultureMethod;
    tenureType: TenureType;
    expiryDate: string;
  },
): Promise<Site> {
  return runCrudOperation({
    configName: 'aq-site-registry',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      if (!input.siteName?.trim()) {
        throw new AppError('siteName is required', ErrorCode.BAD_REQUEST);
      }
      if (!TenureTypes.includes(input.tenureType)) {
        throw new AppError('invalid tenureType', ErrorCode.BAD_REQUEST);
      }
      if (!CultureMethods.includes(input.cultureMethod)) {
        throw new AppError('invalid cultureMethod', ErrorCode.BAD_REQUEST);
      }
      if (
        typeof input.areaHectares !== 'number' ||
        input.areaHectares <= 0
      ) {
        throw new AppError('areaHectares must be positive', ErrorCode.BAD_REQUEST);
      }
      if (!input.speciesAuthorized?.length) {
        throw new AppError('speciesAuthorized required', ErrorCode.BAD_REQUEST);
      }
      const exp = Date.parse(input.expiryDate);
      if (Number.isNaN(exp)) {
        throw new AppError('invalid expiryDate', ErrorCode.BAD_REQUEST);
      }
      const boundary = assertPolygon(input.boundaryGeoJson);
      const count = [...sites.values()].filter((s) => s.tenantId === tenantId)
        .length;
      if (count >= config.maxSitesPerTenant) {
        throw new AppError('Site limit reached', ErrorCode.FORBIDDEN);
      }
      const site: Site = {
        id: crypto.randomUUID(),
        tenantId,
        siteName: input.siteName.trim(),
        leaseNumber: input.leaseNumber?.trim() || null,
        licenceNumber: input.licenceNumber?.trim() || null,
        boundaryGeoJson: boundary,
        areaHectares: input.areaHectares,
        speciesAuthorized: input.speciesAuthorized.map((s) => s.trim()),
        cultureMethod: input.cultureMethod,
        tenureType: input.tenureType,
        expiryDate: new Date(exp).toISOString(),
        createdAt: new Date().toISOString(),
      };
      sites.set(site.id, site);
      logger.info({ siteId: site.id, name: site.siteName }, 'Site registered');
      return site;
    },
    auditAction: 'data.created',
    auditResource: 'aq_site',
    meterEventType: 'api_call',
  });
}

export async function getSiteAuthorization(
  tenantId: string,
  siteId: string,
): Promise<{
  siteId: string;
  speciesAuthorized: string[];
  cultureMethod: CultureMethod;
  tenureType: TenureType;
  licenceNumber: string | null;
  leaseNumber: string | null;
  expiryDate: string;
}> {
  const site = sites.get(siteId);
  if (!site || site.tenantId !== tenantId) {
    throw new AppError('Site not found', ErrorCode.NOT_FOUND);
  }
  return {
    siteId: site.id,
    speciesAuthorized: site.speciesAuthorized,
    cultureMethod: site.cultureMethod,
    tenureType: site.tenureType,
    licenceNumber: site.licenceNumber,
    leaseNumber: site.leaseNumber,
    expiryDate: site.expiryDate,
  };
}

export async function checkExpiry(
  tenantId: string,
  withinDays?: number,
): Promise<Site[]> {
  const config = await loadCfg();
  const days = withinDays ?? config.defaultExpiryWarningDays;
  const now = Date.now();
  const horizon = now + days * 86_400_000;
  return [...sites.values()]
    .filter((s) => {
      if (s.tenantId !== tenantId) return false;
      const exp = Date.parse(s.expiryDate);
      return exp >= now && exp <= horizon;
    })
    .sort((a, b) => Date.parse(a.expiryDate) - Date.parse(b.expiryDate));
}

export async function getSitesInArea(
  tenantId: string,
  boundaryGeoJson: GeoJsonPolygon,
): Promise<Site[]> {
  const area = assertPolygon(boundaryGeoJson);
  // MVP: include site if its centroid falls inside the query polygon
  const out: Site[] = [];
  for (const s of sites.values()) {
    if (s.tenantId !== tenantId) continue;
    const ring = s.boundaryGeoJson.coordinates[0] || [];
    if (!ring.length) continue;
    let lat = 0;
    let lon = 0;
    for (const [x, y] of ring) {
      lon += x;
      lat += y;
    }
    lat /= ring.length;
    lon /= ring.length;
    if (pointInPolygon(lon, lat, area)) out.push(s);
  }
  return out;
}

export async function getSite(
  tenantId: string,
  siteId: string,
): Promise<Site | null> {
  const s = sites.get(siteId);
  if (!s || s.tenantId !== tenantId) return null;
  return s;
}

export function isSpeciesAuthorized(
  site: Site,
  species: string,
): boolean {
  return site.speciesAuthorized
    .map((s) => s.toLowerCase())
    .includes(species.toLowerCase());
}
