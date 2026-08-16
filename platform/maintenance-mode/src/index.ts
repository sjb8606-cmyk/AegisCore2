import { withTenantQuery } from '@platform/tenancy';
import { AppError, ErrorCode, parseUserId, isValidUuid } from '@platform/utils';
export { AppError, ErrorCode };
import { z } from 'zod';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export const CreateMaintenanceWindowSchema = z.object({
  scope: z.enum(['platform', 'tenant']),
  title: z.string().min(1).max(255),
  reason: z.string().optional(),
  starts_at: z.string().datetime(),
  ends_at: z.string().datetime(),
  status: z.enum(['scheduled', 'active', 'completed', 'canceled']).default('scheduled'),
});

export const BypassEntrySchema = z.object({
  bypass_type: z.enum(['ip', 'user_id', 'role']),
  bypass_value: z.string().min(1),
});

function loadConfig() {
  const configPath = path.join(process.cwd(), 'config', 'maintenance-mode.json');
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return { enabled: true, tiers: { requestGating: true, bypassAllowlist: true } };
}

export async function createMaintenanceWindow(tenantId: string, data: any) {
  const cfg = loadConfig();
  if (!cfg.enabled) throw new AppError('Maintenance mode module is disabled', 'FORBIDDEN');

  const parsed = CreateMaintenanceWindowSchema.parse(data);
  const windowId = crypto.randomUUID();

  // If scope is platform, tenant_id must be null for global administration scope
  const targetTenant = parsed.scope === 'platform' ? null : tenantId;

  const res = await withTenantQuery(`
    INSERT INTO maintenance_windows (id, tenant_id, scope, title, reason, status, starts_at, ends_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *;
  `, [windowId, targetTenant, parsed.scope, parsed.title, parsed.reason || null, parsed.status, parsed.starts_at, parsed.ends_at], tenantId);

  return res[0];
}

export async function addBypassEntry(tenantId: string, windowId: string, data: any) {
  if (!isValidUuid(windowId)) throw new AppError('Invalid Window ID format.', 'BAD_REQUEST');
  const parsed = BypassEntrySchema.parse(data);
  
  const entryId = crypto.randomUUID();
  const res = await withTenantQuery(`
    INSERT INTO maintenance_bypass_entries (id, window_id, bypass_type, bypass_value)
    VALUES ($1, $2, $3, $4) RETURNING *;
  `, [entryId, windowId, parsed.bypass_type, parsed.bypass_value], tenantId);

  return res[0];
}

// Deterministic Request Gate middleware logic
export async function evaluateRequestGate(tenantId: string, userId: string, userRole: string, clientIp: string) {
  const cfg = loadConfig();
  if (!cfg.enabled || !cfg.tiers.requestGating) return { allowed: true };

  // Check if any active maintenance window is running (platform-global or tenant-specific)
  const activeRes = await withTenantQuery(`
    SELECT * FROM maintenance_windows 
    WHERE status = 'active' AND (tenant_id = $1 OR scope = 'platform')
    ORDER BY starts_at ASC;
  `, [tenantId], tenantId);

  const activeWindow = activeRes[0];
  if (!activeWindow) return { allowed: true }; // No active maintenance window

  // Check bypass allowlist entries
  if (cfg.tiers.bypassAllowlist) {
    const bypassRes = await withTenantQuery(`
      SELECT * FROM maintenance_bypass_entries 
      WHERE window_id = $1 
        AND (
          (bypass_type = 'user_id' AND bypass_value = $2) OR
          (bypass_type = 'role' AND bypass_value = $3) OR
          (bypass_type = 'ip' AND bypass_value = $4)
        );
    `, [activeWindow.id, userId, userRole, clientIp], tenantId);

    if (bypassRes && bypassRes.length > 0) {
      return {
        allowed: true,
        bypassed: true,
        reason: `Bypass authorized via match of rule type: ${bypassRes[0].bypass_type}`
      };
    }
  }

  // Block completely
  throw new AppError(`System Maintenance: This platform is currently undergoing scheduled maintenance: '${activeWindow.title}'. Please try again later.`, 'SERVICE_UNAVAILABLE');
}

export async function getMaintenanceLedger(tenantId: string, windowId: string) {
  if (!isValidUuid(windowId)) throw new AppError('Invalid Window ID format.', 'BAD_REQUEST');

  const winRes = await withTenantQuery(`
    SELECT * FROM maintenance_windows WHERE id = $1 AND (tenant_id = $2 OR tenant_id IS NULL);
  `, [windowId, tenantId], tenantId);
  const window = winRes[0];
  if (!window) throw new AppError('Maintenance window not found.', 'NOT_FOUND');

  const bypassList = await withTenantQuery(`
    SELECT * FROM maintenance_bypass_entries WHERE window_id = $1;
  `, [windowId], tenantId);

  return {
    ...window,
    bypass_allowlist: bypassList
  };
}
