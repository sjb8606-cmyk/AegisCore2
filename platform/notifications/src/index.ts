import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { withTenantQuery } from '../../tenancy/src/index';
import { AppError, ErrorCode } from '../../utils/src/index';

export const NotificationConfigSchema = z.object({
  enabled: z.boolean(),
  tiers: z.object({
    email: z.boolean().default(true),
    sms: z.boolean().default(false),
    push: z.boolean().default(false),
    templateEditor: z.boolean().default(false),
    deliveryTracking: z.boolean().default(false),
    piiScrubbing: z.boolean().default(false),
    auditTrail: z.boolean().default(true),
    webhookDelivery: z.boolean().default(false),
  }),
  limits: z.object({
    emailPerHour: z.number().default(100),
    smsPerHour: z.number().default(0),
    pushPerHour: z.number().default(0),
    templateCount: z.number().default(5),
  }),
  email: z.object({
    provider: z.string().default('sendgrid'),
    fromAddress: z.string().optional(),
    fromName: z.string().optional(),
  }).default({}),
  sms: z.object({
    provider: z.string().default('twilio'),
    fromNumber: z.string().optional(),
  }).default({}),
  push: z.object({
    provider: z.string().default('fcm'),
  }).default({}),
});

export type NotificationConfig = z.infer<typeof NotificationConfigSchema>;

export interface SendPayload {
  templateId?: string;
  recipientId?: string;
  recipient: string;
  variables?: Record<string, string>;
  channel?: 'email' | 'sms' | 'push';
  subject?: string;
  body?: string;
}

let cachedConfig: NotificationConfig | null = null;

export function loadConfig(): NotificationConfig {
  if (cachedConfig) return cachedConfig;
  const configPath = path.resolve(process.cwd(), 'config/notifications.json');
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8');
      cachedConfig = NotificationConfigSchema.parse(JSON.parse(raw));
      return cachedConfig;
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  
  cachedConfig = NotificationConfigSchema.parse({
    enabled: true,
    tiers: { email: true, sms: false, push: false },
    limits: { emailPerHour: 100, smsPerHour: 0, pushPerHour: 0 }
  });
  return cachedConfig;
}

export class NotificationService {
  static async send(tenantId: string, payload: SendPayload): Promise<{ success: boolean; logId?: string; error?: string }> {
    const config = loadConfig();
    if (!config.enabled) throw new AppError('Notification services globally disabled', ErrorCode.FORBIDDEN);

    const channel = payload.channel || 'email';
    let providerId = `sg_${Math.random().toString(36).substring(7)}`;

    const sql = `
      INSERT INTO notification_logs (tenant_id, channel, recipient, subject, status, provider_id)
      VALUES ($1::uuid, $2, $3, $4, $5, $6)
      RETURNING id
    `;
    const params = [tenantId, channel, payload.recipient, payload.subject || null, 'sent', providerId];
    const rows = await withTenantQuery(sql, params, tenantId);

    if (!rows || rows.length === 0) {
      throw new AppError('Failed to record notification log', ErrorCode.INTERNAL);
    }

    return { success: true, logId: rows[0].id };
  }

  static async fetchLogs(tenantId: string): Promise<any[]> {
    const sql = `SELECT * FROM notification_logs WHERE tenant_id = $1::uuid ORDER BY created_at DESC LIMIT 100`;
    return await withTenantQuery(sql, [tenantId], tenantId);
  }
}
