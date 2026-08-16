import { parseUserId } from '@platform/utils';
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { withTenantQuery } from '../../tenancy/src/index';
import { AppError, ErrorCode } from '../../utils/src/index';
export { AppError, ErrorCode };

export const PushCampaignSchema = z.object({
  name: z.string().min(1),
  title: z.string().min(1),
  message: z.string().min(1),
  scheduled_at: z.string().datetime().optional(),
});

export const DeviceRegistrationSchema = z.object({
  device_token: z.string().min(1),
  platform: z.enum(['ios','android','web']),
});

export const PushCampaignsConfigSchema = z.object({
  enabled: z.boolean(),
  tiers: z.object({
    basicPush: z.boolean().default(true),
    deviceRegistry: z.boolean().default(true),
    campaigns: z.boolean().default(true),
    segmentation: z.boolean().default(true),
    scheduling: z.boolean().default(true),
    templateEngine: z.boolean().default(false),
    deliveryTracking: z.boolean().default(true),
    clickTracking: z.boolean().default(false),
    retryQueue: z.boolean().default(false),
    mutePreferences: z.boolean().default(true),
    platformRouting: z.boolean().default(false),
    batchDelivery: z.boolean().default(false),
    analyticsReporting: z.boolean().default(false),
    abTesting: z.boolean().default(false),
    auditTrail: z.boolean().default(true),
  }),
  limits: z.object({
    pushPerSecond: z.number().default(10),
    devicesPerTenant: z.number().default(100),
    campaignsPerDay: z.number().default(5),
  }),
});

export type PushCampaignsConfig = z.infer<typeof PushCampaignsConfigSchema>;

let cachedConfig: PushCampaignsConfig | null = null;

export function loadConfig(): PushCampaignsConfig {
  if (cachedConfig) return cachedConfig;
  const configPath = path.resolve(process.cwd(), 'config/push_campaigns.json');
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8');
      cachedConfig = PushCampaignsConfigSchema.parse(JSON.parse(raw));
      return cachedConfig;
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }

  cachedConfig = PushCampaignsConfigSchema.parse({
    enabled: true,
    tiers: {
      basicPush: true,
      deviceRegistry: true,
      campaigns: true,
      segmentation: true,
      scheduling: true,
      templateEngine: false,
      deliveryTracking: true,
      clickTracking: false,
      retryQueue: false,
      mutePreferences: true,
      platformRouting: false,
      batchDelivery: false,
      analyticsReporting: false,
      abTesting: false,
      auditTrail: true,
    },
    limits: {
      pushPerSecond: 10,
      devicesPerTenant: 100,
      campaignsPerDay: 5,
    }
  });
  return cachedConfig;
}

export class PushCampaignsService {
  static async registerDevice(tenantId: string, userId: string, data: any) {
    const config = loadConfig();
    if (!config.enabled) {
      throw new AppError('Push campaigns platform globally disabled', ErrorCode.FORBIDDEN);
    }

    if (!config.tiers.deviceRegistry) {
      throw new AppError('Device registration is blocked on current tier', ErrorCode.FORBIDDEN);
    }

    const device = DeviceRegistrationSchema.parse(data);
    const cleanUserId = parseUserId(userId);

    const sql = `
      INSERT INTO push_devices (tenant_id, user_id, device_token, platform)
      VALUES ($1::uuid, $2::uuid, $3, $4)
      ON CONFLICT (tenant_id, device_token) 
      DO UPDATE SET is_active = true, last_seen = NOW()
      RETURNING *
    `;
    const params = [tenantId, cleanUserId, device.device_token, device.platform];

    const rows = await withTenantQuery(sql, params, tenantId);
    if (!rows || rows.length === 0) {
      throw new AppError('Failed to record push device details', ErrorCode.INTERNAL);
    }

    return rows[0];
  }

  static async createCampaign(tenantId: string, data: any) {
    const config = loadConfig();
    if (!config.enabled) {
      throw new AppError('Push campaigns platform globally disabled', ErrorCode.FORBIDDEN);
    }

    if (!config.tiers.campaigns) {
      throw new AppError('Campaign orchestration features are blocked on current tier', ErrorCode.FORBIDDEN);
    }

    const campaign = PushCampaignSchema.parse(data);

    const sql = `
      INSERT INTO push_campaigns (tenant_id, name, title, message, status, scheduled_at)
      VALUES ($1::uuid, $2, $3, $4, 'draft', $5)
      RETURNING *
    `;
    const params = [tenantId, campaign.name, campaign.title, campaign.message, campaign.scheduled_at || null];

    const rows = await withTenantQuery(sql, params, tenantId);
    if (!rows || rows.length === 0) {
      throw new AppError('Failed to record campaign details', ErrorCode.INTERNAL);
    }

    return rows[0];
  }

  static async sendCampaign(tenantId: string, campaignId: string) {
    const config = loadConfig();
    if (!config.enabled) {
      throw new AppError('Push campaigns platform globally disabled', ErrorCode.FORBIDDEN);
    }

    if (!config.tiers.basicPush) {
      throw new AppError('Campaign execution is blocked on current tier', ErrorCode.FORBIDDEN);
    }

    const sql = `
      UPDATE push_campaigns 
      SET status = 'sending' 
      WHERE id = $1::uuid AND tenant_id = $2::uuid 
      RETURNING *
    `;
    const rows = await withTenantQuery(sql, [campaignId, tenantId], tenantId);

    if (!rows || rows.length === 0) {
      throw new AppError('Campaign not found', ErrorCode.NOT_FOUND);
    }

    return { status: 'sending_queued' };
  }

  static async fetchCampaigns(tenantId: string): Promise<any[]> {
    const sql = `
      SELECT id, name, title, message, status, scheduled_at, total_recipients, created_at 
      FROM push_campaigns 
      WHERE tenant_id = $1::uuid
      ORDER BY created_at DESC
      LIMIT 100
    `;
    return await withTenantQuery(sql, [tenantId], tenantId);
  }
}
