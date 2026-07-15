import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { withTenantQuery } from '../../tenancy/src/index';
import { AppError, ErrorCode } from '../../utils/src/index';

export const CampaignSchema = z.object({
  name: z.string().min(1),
  message_template: z.string().min(1),
  scheduled_at: z.string().datetime().optional(),
});

export const RecipientSchema = z.object({
  phone_number: z.string().regex(/^\+?[1-9]\d{1,14}$/),
});

export const SmsCampaignsConfigSchema = z.object({
  enabled: z.boolean(),
  tiers: z.object({
    basicSmsSending: z.boolean().default(true),
    bulkCampaigns: z.boolean().default(true),
    templateEngine: z.boolean().default(true),
    deliveryTracking: z.boolean().default(true),
    segmentation: z.boolean().default(true),
    scheduling: z.boolean().default(true),
    optOutHandling: z.boolean().default(true),
    phoneValidation: z.boolean().default(false),
    retryQueue: z.boolean().default(false),
    campaignAnalytics: z.boolean().default(false),
    carrierRateControl: z.boolean().default(false),
    dlrProcessing: z.boolean().default(false),
    complianceLogging: z.boolean().default(false),
    auditTrail: z.boolean().default(true),
  }),
  limits: z.object({
    messagesPerSecond: z.number().default(10),
    messagesPerTenantPerMonth: z.number().default(5000),
    campaignsPerDay: z.number().default(3),
  }),
});

export type SmsCampaignsConfig = z.infer<typeof SmsCampaignsConfigSchema>;

let cachedConfig: SmsCampaignsConfig | null = null;

export function loadConfig(): SmsCampaignsConfig {
  if (cachedConfig) return cachedConfig;
  const configPath = path.resolve(process.cwd(), 'config/sms_campaigns.json');
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8');
      cachedConfig = SmsCampaignsConfigSchema.parse(JSON.parse(raw));
      return cachedConfig;
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }

  cachedConfig = SmsCampaignsConfigSchema.parse({
    enabled: true,
    tiers: {
      basicSmsSending: true,
      bulkCampaigns: true,
      templateEngine: true,
      deliveryTracking: true,
      segmentation: true,
      scheduling: true,
      optOutHandling: true,
      phoneValidation: false,
      retryQueue: false,
      campaignAnalytics: false,
      carrierRateControl: false,
      dlrProcessing: false,
      complianceLogging: false,
      auditTrail: true,
    },
    limits: {
      messagesPerSecond: 10,
      messagesPerTenantPerMonth: 5000,
      campaignsPerDay: 3,
    }
  });
  return cachedConfig;
}

export class SmsCampaignsService {
  static async createCampaign(tenantId: string, data: any) {
    const config = loadConfig();
    if (!config.enabled) {
      throw new AppError('SMS marketing engine globally disabled', ErrorCode.FORBIDDEN);
    }

    if (!config.tiers.basicSmsSending) {
      throw new AppError('Basic SMS sending features are blocked on current tier', ErrorCode.FORBIDDEN);
    }

    const campaign = CampaignSchema.parse(data);

    const sql = `
      INSERT INTO sms_campaigns (tenant_id, name, message_template, status)
      VALUES ($1::uuid, $2, $3, 'draft') RETURNING *
    `;
    const params = [tenantId, campaign.name, campaign.message_template];

    const rows = await withTenantQuery(sql, params, tenantId);
    if (!rows || rows.length === 0) {
      throw new AppError('Failed to record campaign details', ErrorCode.INTERNAL);
    }

    return rows[0];
  }

  static async sendCampaign(tenantId: string, campaignId: string) {
    const config = loadConfig();
    if (!config.enabled) {
      throw new AppError('SMS marketing engine globally disabled', ErrorCode.FORBIDDEN);
    }

    if (!config.tiers.bulkCampaigns) {
      throw new AppError('Bulk campaign execution features are blocked on current tier', ErrorCode.FORBIDDEN);
    }

    const sql = `
      UPDATE sms_campaigns 
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

  static async registerOptOut(tenantId: string, phoneNumber: string, reason?: string) {
    const config = loadConfig();
    if (!config.enabled) {
      throw new AppError('SMS marketing engine globally disabled', ErrorCode.FORBIDDEN);
    }

    if (!config.tiers.optOutHandling) {
      throw new AppError('Telecom opt-out systems are blocked on current tier', ErrorCode.FORBIDDEN);
    }

    const sql = `
      INSERT INTO sms_opt_outs (tenant_id, phone_number, reason)
      VALUES ($1::uuid, $2, $3)
      ON CONFLICT (tenant_id, phone_number) DO NOTHING
      RETURNING *
    `;
    const params = [tenantId, phoneNumber, reason || null];

    const rows = await withTenantQuery(sql, params, tenantId);
    if (!rows || rows.length === 0) {
      return { status: 'already_opted_out' };
    }

    return rows[0];
  }

  static async fetchCampaigns(tenantId: string): Promise<any[]> {
    const sql = `
      SELECT id, name, message_template, status, scheduled_at, total_recipients, created_at 
      FROM sms_campaigns 
      WHERE tenant_id = $1::uuid
      ORDER BY created_at DESC
      LIMIT 100
    `;
    return await withTenantQuery(sql, [tenantId], tenantId);
  }
}
