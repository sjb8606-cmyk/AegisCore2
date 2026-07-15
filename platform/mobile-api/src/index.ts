import { withTenantQuery } from '@platform/tenancy';
import { z } from 'zod';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export class AppError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export const RegisterDeviceSchema = z.object({
  device_fingerprint: z.string().min(8),
  platform: z.enum(['ios', 'android', 'pwa']),
  app_version: z.string(),
  push_token: z.string().optional(),
});

export const AnalyticsBatchSchema = z.object({
  device_id: z.string().uuid(),
  events: z.array(z.object({
    event_name: z.string(),
    properties: z.record(z.any()).optional(),
    occurred_at: z.string().datetime().optional(),
  })).max(50),
});

export function isValidUuid(id: any): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return typeof id === 'string' && uuidRegex.test(id);
}

export function parseUserId(userId: any): string {
  if (isValidUuid(userId)) return userId;
  throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, 'BAD_REQUEST');
}

function loadConfig() {
  try {
    const configPath = path.join(process.cwd(), 'config', 'mobile-api.json');
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return { enabled: true, tiers: { versionEnforcement: true, mobileAnalyticsIngestion: true }, thresholds: { minSupportedAppVersion: "1.0.0" } };
}

// Integrated Semantic Version comparison utility
export function compareVersions(a: string, b: string): number {
  const arrA = a.split('.').map(Number);
  const arrB = b.split('.').map(Number);
  for (let i = 0; i < Math.max(arrA.length, arrB.length); i++) {
    const diff = (arrA[i] || 0) - (arrB[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function validateAppVersion(appVersion: string, minVersion: string): void {
  if (compareVersions(appVersion, minVersion) < 0) {
    throw new AppError(`App version ${appVersion} is no longer supported. Minimum version: ${minVersion}.`, 'FORBIDDEN');
  }
}

export async function registerDevice(tenantId: string, userId: string, data: any) {
  const cfg = loadConfig();
  if (!cfg.enabled) throw new AppError('Mobile API module is disabled', 'FORBIDDEN');

  const parsed = RegisterDeviceSchema.parse(data);
  const cleanUserId = parseUserId(userId);

  // SemVer enforcement validation gate
  if (cfg.tiers.versionEnforcement) {
    validateAppVersion(parsed.app_version, cfg.thresholds.minSupportedAppVersion);
  }

  const deviceId = crypto.randomUUID();

  // Atomic device upsert registration
  const res = await withTenantQuery(`
    INSERT INTO mobile_devices (id, tenant_id, user_id, device_fingerprint, platform, app_version, push_token, status)
    VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
    ON CONFLICT (tenant_id, device_fingerprint) 
    DO UPDATE SET app_version = EXCLUDED.app_version, last_seen_at = NOW(), push_token = EXCLUDED.push_token
    RETURNING *;
  `, [deviceId, tenantId, cleanUserId, parsed.device_fingerprint, parsed.platform, parsed.app_version, parsed.push_token || null], tenantId);

  return res[0];
}

export async function ingestAnalyticsEvents(tenantId: string, data: any) {
  const cfg = loadConfig();
  if (!cfg.enabled || !cfg.tiers.mobileAnalyticsIngestion) {
    throw new AppError('Mobile analytics ingestion tier is disabled', 'FORBIDDEN');
  }

  const parsed = AnalyticsBatchSchema.parse(data);
  if (!isValidUuid(parsed.device_id)) throw new AppError('Invalid Device ID format.', 'BAD_REQUEST');

  const insertedEvents = [];
  for (const event of parsed.events) {
    const eventId = crypto.randomUUID();
    const occurredAt = event.occurred_at || new Date().toISOString();

    const res = await withTenantQuery(`
      INSERT INTO mobile_analytics_events (id, tenant_id, device_id, event_name, properties, occurred_at)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;
    `, [eventId, tenantId, parsed.device_id, event.event_name, JSON.stringify(event.properties || {}), occurredAt], tenantId);

    insertedEvents.push(res[0]);
  }

  return insertedEvents;
}

export async function getDeviceLedger(tenantId: string, deviceId: string) {
  if (!isValidUuid(deviceId)) throw new AppError('Invalid Device ID format.', 'BAD_REQUEST');

  const deviceRes = await withTenantQuery(`
    SELECT * FROM mobile_devices WHERE id = $1 AND tenant_id = $2;
  `, [deviceId, tenantId], tenantId);
  const device = deviceRes[0];
  if (!device) throw new AppError('Mobile device not found.', 'NOT_FOUND');

  const analytics = await withTenantQuery(`
    SELECT * FROM mobile_analytics_events WHERE device_id = $1 AND tenant_id = $2 ORDER BY occurred_at DESC;
  `, [deviceId, tenantId], tenantId);

  return {
    ...device,
    analytics_history: analytics
  };
}
