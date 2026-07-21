import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { withTenantQuery } from '../../tenancy/src/index';
import { AppError, ErrorCode } from '../../utils/src/index';
export { AppError, ErrorCode };

export const CampaignSchema = z.object({
  name: z.string().min(1),
  subject: z.string().min(1),
  template_id: z.string().uuid().optional(),
});

export const AudienceSchema = z.object({
  name: z.string().min(1),
  filters: z.record(z.any()).optional(),
});

export const EmailMarketingConfigSchema = z.object({
  enabled: z.boolean(),
  tiers: z.object({
    basicEmailSending: z.boolean().default(true),
    campaignBuilder: z.boolean().default(true),
    templateEngine: z.boolean().default(true),
    audienceLists: z.boolean().default(true),
    segmentation: z.boolean().default(true),
    scheduling: z.boolean().default(true),
    dripCampaigns: z.boolean().default(false),
    a_b_testing: z.boolean().default(false),
    deliveryTracking: z.boolean().default(true),
    unsubscribeManagement: z.boolean().default(true),
    personalization: z.boolean().default(false),
    bounceHandling: z.boolean().default(true),
    analyticsReporting: z.boolean().default(false),
    automationTriggers: z.boolean().default(false),
    auditTrail: z.boolean().default(true),
  }),
  limits: z.object({
    emailsPerMonth: z.number().default(10000),
    campaignsPerDay: z.number().default(5),
    templatesPerTenant: z.number().default(10),
  }),
});

export type EmailMarketingConfig = z.infer<typeof EmailMarketingConfigSchema>;

let cachedConfig: EmailMarketingConfig | null = null;

export function loadConfig(): EmailMarketingConfig {
  if (cachedConfig) return cachedConfig;
  const configPath = path.resolve(process.cwd(), 'config/email_marketing.json');
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8');
      cachedConfig = EmailMarketingConfigSchema.parse(JSON.parse(raw));
      return cachedConfig;
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }

  cachedConfig = EmailMarketingConfigSchema.parse({
    enabled: true,
    tiers: {
      basicEmailSending: true,
      campaignBuilder: true,
      templateEngine: true,
      audienceLists: true,
      segmentation: true,
      scheduling: true,
      dripCampaigns: false,
      a_b_testing: false,
      deliveryTracking: true,
      unsubscribeManagement: true,
      personalization: false,
      bounceHandling: true,
      analyticsReporting: false,
      automationTriggers: false,
      auditTrail: true,
    },
    limits: {
      emailsPerMonth: 10000,
      campaignsPerDay: 5,
      templatesPerTenant: 10,
    }
  });
  return cachedConfig;
}

export class EmailMarketingService {
  static async createCampaign(tenantId: string, data: any) {
    const config = loadConfig();
    if (!config.enabled) {
      throw new AppError('Email marketing platform globally disabled', ErrorCode.FORBIDDEN);
    }

    if (!config.tiers.basicEmailSending) {
      throw new AppError('Basic email sending is blocked on current tier', ErrorCode.FORBIDDEN);
    }

    const campaign = CampaignSchema.parse(data);

    const sql = `
      INSERT INTO email_campaigns (tenant_id, name, subject, status)
      VALUES ($1::uuid, $2, $3, 'draft') RETURNING *
    `;
    const params = [tenantId, campaign.name, campaign.subject];

    const rows = await withTenantQuery(sql, params, tenantId);
    if (!rows || rows.length === 0) {
      throw new AppError('Failed to record campaign details', ErrorCode.INTERNAL);
    }

    return rows[0];
  }

  static async sendCampaign(tenantId: string, campaignId: string) {
    const config = loadConfig();
    if (!config.enabled) {
      throw new AppError('Email marketing platform globally disabled', ErrorCode.FORBIDDEN);
    }

    if (!config.tiers.basicEmailSending) {
      throw new AppError('Basic email sending is blocked on current tier', ErrorCode.FORBIDDEN);
    }

    const sql = `
      UPDATE email_campaigns SET status = 'sending' WHERE id = $1::uuid AND tenant_id = $2::uuid RETURNING *
    `;
    const rows = await withTenantQuery(sql, [campaignId, tenantId], tenantId);

    if (!rows || rows.length === 0) {
      throw new AppError('Campaign not found', ErrorCode.NOT_FOUND);
    }

    return { status: 'sending_queued' };
  }

  static async registerUnsubscribe(tenantId: string, email: string, reason?: string) {
    const config = loadConfig();
    if (!config.enabled) {
      throw new AppError('Email marketing platform globally disabled', ErrorCode.FORBIDDEN);
    }

    if (!config.tiers.unsubscribeManagement) {
      throw new AppError('Unsubscribe management is blocked on current tier', ErrorCode.FORBIDDEN);
    }

    const sql = `
      INSERT INTO email_unsubscribes (tenant_id, email, reason)
      VALUES ($1::uuid, $2, $3)
      ON CONFLICT (tenant_id, email) DO NOTHING
      RETURNING *
    `;
    const params = [tenantId, email, reason || null];

    const rows = await withTenantQuery(sql, params, tenantId);
    if (!rows || rows.length === 0) {
      return { status: 'already_unsubscribed' };
    }

    return rows[0];
  }

  static async fetchCampaigns(tenantId: string): Promise<any[]> {
    const sql = `
      SELECT id, name, subject, status, scheduled_at, total_recipients, created_at 
      FROM email_campaigns 
      WHERE tenant_id = $1::uuid
      ORDER BY created_at DESC
      LIMIT 100
    `;
    return await withTenantQuery(sql, [tenantId], tenantId);
  }
}
