/**
 * platform/notifications/src/index.ts
 *
 * NotificationService.send() — real provider integration.
 *
 * Previously: fabricated a fake provider ID (`sg_${random}`), wrote a
 * notification_logs row marked status: 'sent', and never called
 * SendGrid/Twilio/FCM. Confirmed direct consequence: TIDELOCK's
 * abnormal-loss-alert feature depends on this — a real abnormal
 * yield loss would never actually notify anyone while the system
 * logged "sent".
 *
 * Fix: email now makes a real SendGrid v3 call. SMS/push throw
 * NOT_IMPLEMENTED instead of faking success — Twilio/FCM aren't
 * wired yet. This repo already has the right pattern for that
 * (platform/sso throws NOT_IMPLEMENTED for SAML rather than
 * silently accepting anything) — this follows it.
 *
 * Also fixed: the tier gate was missing entirely. A payload with
 * channel: 'sms' would previously "succeed" even with tiers.sms
 * false in config. Now checked before anything else runs.
 */
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { withTenantQuery } from '../../tenancy/src/index';
import { AppError, ErrorCode } from '../../utils/src/index';
export { AppError, ErrorCode };

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

/** Exposed for tests only — clears the module-level config cache. */
export function __resetConfigCache(): void {
  cachedConfig = null;
}

// ── Real provider call ──────────────────────────────────────────

async function sendViaSendGrid(config: NotificationConfig, payload: SendPayload): Promise<{ providerId: string }> {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) {
    throw new AppError('SENDGRID_API_KEY is not set — cannot send real email', ErrorCode.SERVICE_UNAVAILABLE);
  }

  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: payload.recipient }] }],
      from: {
        email: config.email.fromAddress ?? 'no-reply@localhost',
        name: config.email.fromName ?? undefined,
      },
      subject: payload.subject ?? '(no subject)',
      content: [{ type: 'text/plain', value: payload.body ?? '' }],
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new AppError(`SendGrid request failed (${res.status}): ${errBody}`, ErrorCode.SERVICE_UNAVAILABLE);
  }

  const providerId = res.headers.get('x-message-id') ?? '';
  return { providerId };
}

export class NotificationService {
  static async send(tenantId: string, payload: SendPayload): Promise<{ success: boolean; logId?: string; error?: string }> {
    const config = loadConfig();
    if (!config.enabled) throw new AppError('Notification services globally disabled', ErrorCode.FORBIDDEN);

    const channel = payload.channel || 'email';

    if (!config.tiers[channel]) {
      throw new AppError(`Channel "${channel}" is not enabled for this tenant's tier`, ErrorCode.FORBIDDEN);
    }

    // 1. Log as queued FIRST — a failed provider call still leaves a
    // real, honest record instead of nothing.
    const insertSql = `
      INSERT INTO notification_logs (tenant_id, channel, recipient, subject, status)
      VALUES ($1::uuid, $2, $3, $4, 'queued')
      RETURNING id
    `;
    const insertRows = await withTenantQuery(insertSql, [tenantId, channel, payload.recipient, payload.subject || null], tenantId);
    if (!insertRows || insertRows.length === 0) {
      throw new AppError('Failed to record notification log', ErrorCode.INTERNAL);
    }
    const logId = insertRows[0].id;

    // 2. Real send. Email is wired to SendGrid; sms/push have no real
    // integration yet — fail loudly rather than fake success. (The
    // tier check above already blocks sms/push under default config;
    // this is the second, defense-in-depth gate for if a tier gets
    // flipped on before the provider is actually built.)
    try {
      let providerId: string;

      if (channel === 'email') {
        ({ providerId } = await sendViaSendGrid(config, payload));
      } else {
        throw new AppError(
          `Channel "${channel}" has no real provider integration yet (only email/SendGrid is wired)`,
          ErrorCode.NOT_IMPLEMENTED,
        );
      }

      await withTenantQuery(
        `UPDATE notification_logs SET status = 'sent', provider_id = $1, sent_at = now() WHERE id = $2::uuid`,
        [providerId || null, logId],
        tenantId,
      );

      return { success: true, logId };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await withTenantQuery(
        `UPDATE notification_logs SET status = 'failed', error = $1 WHERE id = $2::uuid`,
        [message, logId],
        tenantId,
      );
      throw err;
    }
  }

  static async fetchLogs(tenantId: string): Promise<any[]> {
    const sql = `SELECT * FROM notification_logs WHERE tenant_id = $1::uuid ORDER BY created_at DESC LIMIT 100`;
    return await withTenantQuery(sql, [tenantId], tenantId);
  }
}
