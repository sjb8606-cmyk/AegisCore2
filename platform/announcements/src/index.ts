import { parseUserId } from '@platform/utils';
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { withTenantQuery } from '../../tenancy/src/index';
import { AppError, ErrorCode } from '../../utils/src/index';
export { AppError, ErrorCode };

export const AnnouncementSchema = z.object({
  title: z.string().min(1),
  message: z.string().min(1),
  type: z.enum(['info','warning','critical']),
  format: z.enum(['banner','modal','feed']),
  start_at: z.string().datetime().optional(),
  end_at: z.string().datetime().optional(),
});

export const AnnouncementsConfigSchema = z.object({
  enabled: z.boolean(),
  tiers: z.object({
    basicAnnouncements: z.boolean().default(true),
    bannerMessages: z.boolean().default(true),
    modalAnnouncements: z.boolean().default(true),
    targetingRules: z.boolean().default(true),
    scheduling: z.boolean().default(true),
    expiration: z.boolean().default(true),
    readTracking: z.boolean().default(true),
    dismissTracking: z.boolean().default(true),
    changelogFeed: z.boolean().default(true),
    priorityLevels: z.boolean().default(false),
    multiChannelHooks: z.boolean().default(false),
    abTesting: z.boolean().default(false),
    realTimeBroadcast: z.boolean().default(false),
    analyticsReporting: z.boolean().default(false),
    auditTrail: z.boolean().default(true),
  }),
  limits: z.object({
    announcementsPerDay: z.number().default(10),
    activeAnnouncementsPerTenant: z.number().default(5),
    targetAudienceSize: z.number().default(1000),
  }),
});

export type AnnouncementsConfig = z.infer<typeof AnnouncementsConfigSchema>;

let cachedConfig: AnnouncementsConfig | null = null;

export function loadConfig(): AnnouncementsConfig {
  if (cachedConfig) return cachedConfig;
  const configPath = path.resolve(process.cwd(), 'config/announcements.json');
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8');
      cachedConfig = AnnouncementsConfigSchema.parse(JSON.parse(raw));
      return cachedConfig;
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }

  cachedConfig = AnnouncementsConfigSchema.parse({
    enabled: true,
    tiers: {
      basicAnnouncements: true,
      bannerMessages: true,
      modalAnnouncements: true,
      targetingRules: true,
      scheduling: true,
      expiration: true,
      readTracking: true,
      dismissTracking: true,
      changelogFeed: true,
      priorityLevels: false,
      multiChannelHooks: false,
      abTesting: false,
      realTimeBroadcast: false,
      analyticsReporting: false,
      auditTrail: true,
    },
    limits: {
      announcementsPerDay: 10,
      activeAnnouncementsPerTenant: 5,
      targetAudienceSize: 1000,
    }
  });
  return cachedConfig;
}

export class AnnouncementsService {
  static async createAnnouncement(tenantId: string, data: any, createdBy: string) {
    const config = loadConfig();
    if (!config.enabled) {
      throw new AppError('Announcements broadcast globally disabled', ErrorCode.FORBIDDEN);
    }

    if (!config.tiers.basicAnnouncements) {
      throw new AppError('Basic announcements blocked on current tier', ErrorCode.FORBIDDEN);
    }

    const announcement = AnnouncementSchema.parse(data);
    const cleanUserId = parseUserId(createdBy);

    const sql = `
      INSERT INTO announcements (tenant_id, title, message, type, format, start_at, end_at, status)
      VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, 'draft')
      RETURNING *
    `;
    const params = [
      tenantId,
      announcement.title,
      announcement.message,
      announcement.type,
      announcement.format,
      announcement.start_at || null,
      announcement.end_at || null
    ];

    const rows = await withTenantQuery(sql, params, tenantId);
    if (!rows || rows.length === 0) {
      throw new AppError('Failed to record new announcement details', ErrorCode.INTERNAL);
    }

    return rows[0];
  }

  static async publishAnnouncement(tenantId: string, announcementId: string) {
    const sql = `
      UPDATE announcements 
      SET status = 'published' 
      WHERE id = $1::uuid AND tenant_id = $2::uuid 
      RETURNING *
    `;
    const rows = await withTenantQuery(sql, [announcementId, tenantId], tenantId);

    if (!rows || rows.length === 0) {
      throw new AppError('Announcement not found', ErrorCode.NOT_FOUND);
    }

    return rows[0];
  }

  static async trackDismiss(tenantId: string, announcementId: string, userId: string) {
    const config = loadConfig();
    if (!config.enabled) {
      throw new AppError('Announcements broadcast globally disabled', ErrorCode.FORBIDDEN);
    }

    if (!config.tiers.dismissTracking) {
      throw new AppError('Announcement dismiss tracking blocked on current tier', ErrorCode.FORBIDDEN);
    }

    const cleanUserId = parseUserId(userId);

    const sql = `
      INSERT INTO announcement_events (tenant_id, announcement_id, user_id, event_type)
      VALUES ($1::uuid, $2::uuid, $3::uuid, 'dismissed')
      RETURNING *
    `;
    const params = [tenantId, announcementId, cleanUserId];

    const rows = await withTenantQuery(sql, params, tenantId);
    if (!rows || rows.length === 0) {
      throw new AppError('Failed to track announcement dismiss event', ErrorCode.INTERNAL);
    }

    return rows[0];
  }

  static async fetchAnnouncements(tenantId: string): Promise<any[]> {
    const sql = `
      SELECT id, title, message, type, format, status, priority, start_at, end_at, created_at 
      FROM announcements 
      WHERE tenant_id = $1::uuid
      ORDER BY created_at DESC
      LIMIT 100
    `;
    return await withTenantQuery(sql, [tenantId], tenantId);
  }
}
