import { parseUserId } from '@platform/utils';
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { withTenantQuery } from '../../tenancy/src/index';
import { AppError, ErrorCode } from '../../utils/src/index';
export { AppError, ErrorCode };

export const FeedbackSchema = z.object({
  type: z.enum(['bug','feature','ux','general']),
  title: z.string().min(1),
  description: z.string().min(1),
  severity: z.number().int().min(1).max(5).optional(),
});

export const VoteSchema = z.object({
  feedback_id: z.string().uuid(),
  vote: z.literal(1),
});

export const FeedbackConfigSchema = z.object({
  enabled: z.boolean(),
  tiers: z.object({
    basicFeedback: z.boolean().default(true),
    bugReports: z.boolean().default(true),
    featureRequests: z.boolean().default(true),
    uxFeedback: z.boolean().default(true),
    categorization: z.boolean().default(true),
    priorityScoring: z.boolean().default(false),
    attachments: z.boolean().default(false),
    statusTracking: z.boolean().default(true),
    triageQueue: z.boolean().default(false),
    assignment: z.boolean().default(false),
    userVoting: z.boolean().default(true),
    tagging: z.boolean().default(true),
    duplicateDetection: z.boolean().default(false),
    internalNotes: z.boolean().default(false),
    advancedAnalytics: z.boolean().default(false),
    auditTrail: z.boolean().default(true),
  }),
  limits: z.object({
    feedbackPerDay: z.number().default(20),
    attachmentsPerFeedback: z.number().default(3),
    maxAttachmentSizeMB: z.number().default(5),
  }),
});

export type FeedbackConfig = z.infer<typeof FeedbackConfigSchema>;

let cachedConfig: FeedbackConfig | null = null;

export function loadConfig(): FeedbackConfig {
  if (cachedConfig) return cachedConfig;
  const configPath = path.resolve(process.cwd(), 'config/feedback.json');
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8');
      cachedConfig = FeedbackConfigSchema.parse(JSON.parse(raw));
      return cachedConfig;
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }

  cachedConfig = FeedbackConfigSchema.parse({
    enabled: true,
    tiers: {
      basicFeedback: true,
      bugReports: true,
      featureRequests: true,
      uxFeedback: true,
      categorization: true,
      priorityScoring: false,
      attachments: false,
      statusTracking: true,
      triageQueue: false,
      assignment: false,
      userVoting: true,
      tagging: true,
      duplicateDetection: false,
      internalNotes: false,
      advancedAnalytics: false,
      auditTrail: true,
    },
    limits: {
      feedbackPerDay: 20,
      attachmentsPerFeedback: 3,
      maxAttachmentSizeMB: 5,
    }
  });
  return cachedConfig;
}

export class FeedbackService {
  static async submitFeedback(tenantId: string, userId: string, data: any) {
    const config = loadConfig();
    if (!config.enabled) {
      throw new AppError('Feedback collection is globally disabled', ErrorCode.FORBIDDEN);
    }

    if (!config.tiers.basicFeedback) {
      throw new AppError('Basic feedback collection is blocked on current tier', ErrorCode.FORBIDDEN);
    }

    const feedback = FeedbackSchema.parse(data);
    const cleanUserId = parseUserId(userId);

    const sql = `
      INSERT INTO feedback_items (tenant_id, user_id, type, title, description, severity)
      VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)
      RETURNING *
    `;
    const params = [tenantId, cleanUserId, feedback.type, feedback.title, feedback.description, feedback.severity || 1];

    const rows = await withTenantQuery(sql, params, tenantId);
    if (!rows || rows.length === 0) {
      throw new AppError('Failed to record user feedback details', ErrorCode.INTERNAL);
    }

    return rows[0];
  }

  static async voteFeedback(tenantId: string, userId: string, data: any) {
    const config = loadConfig();
    if (!config.enabled) {
      throw new AppError('Feedback collection is globally disabled', ErrorCode.FORBIDDEN);
    }

    if (!config.tiers.userVoting) {
      throw new AppError('Feedback voting features are blocked on current tier', ErrorCode.FORBIDDEN);
    }

    const vote = VoteSchema.parse(data);
    const cleanUserId = parseUserId(userId);

    const sql = `
      INSERT INTO feedback_votes (tenant_id, feedback_id, user_id, vote)
      VALUES ($1::uuid, $2::uuid, $3::uuid, $4)
      ON CONFLICT (tenant_id, feedback_id, user_id) DO NOTHING
      RETURNING *
    `;
    const params = [tenantId, vote.feedback_id, cleanUserId, vote.vote];

    const rows = await withTenantQuery(sql, params, tenantId);
    if (!rows || rows.length === 0) {
      return { status: 'acknowledged', duplicate: true };
    }

    return rows[0];
  }

  static async fetchFeedback(tenantId: string): Promise<any[]> {
    const sql = `
      SELECT id, type, title, description, status, severity, priority, created_at 
      FROM feedback_items 
      WHERE tenant_id = $1::uuid AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT 100
    `;
    return await withTenantQuery(sql, [tenantId], tenantId);
  }
}
