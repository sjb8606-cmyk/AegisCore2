import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { withTenantQuery } from '../../tenancy/src/index';
import { AppError, ErrorCode } from '../../utils/src/index';
export { AppError, ErrorCode };

export const ThreadSchema = z.object({
  forum_id: z.string().uuid(),
  title: z.string().min(1),
  content: z.string().min(1),
});

export const CommentSchema = z.object({
  thread_id: z.string().uuid(),
  parent_id: z.string().uuid().optional(),
  content: z.string().min(1),
});

export const CommunityConfigSchema = z.object({
  enabled: z.boolean(),
  tiers: z.object({
    forums: z.boolean().default(true),
    threads: z.boolean().default(true),
    nestedComments: z.boolean().default(true),
    voting: z.boolean().default(true),
    memberDirectory: z.boolean().default(true),
    profiles: z.boolean().default(true),
    tagging: z.boolean().default(false),
    searchIntegration: z.boolean().default(false),
    reporting: z.boolean().default(true),
    moderationQueue: z.boolean().default(false),
    pinnedPosts: z.boolean().default(false),
    reputationSystem: z.boolean().default(true),
    realTimeUpdates: z.boolean().default(false),
    advancedRankingAlgorithm: z.boolean().default(false),
    auditTrail: z.boolean().default(true),
  }),
  limits: z.object({
    postsPerDay: z.number().default(20),
    commentsPerPost: z.number().default(100),
    reportsPerDay: z.number().default(10),
  }),
});

export type CommunityConfig = z.infer<typeof CommunityConfigSchema>;

let cachedConfig: CommunityConfig | null = null;

export function loadConfig(): CommunityConfig {
  if (cachedConfig) return cachedConfig;
  const configPath = path.resolve(process.cwd(), 'config/community.json');
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8');
      cachedConfig = CommunityConfigSchema.parse(JSON.parse(raw));
      return cachedConfig;
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }

  cachedConfig = CommunityConfigSchema.parse({
    enabled: true,
    tiers: {
      forums: true,
      threads: true,
      nestedComments: true,
      voting: true,
      memberDirectory: true,
      profiles: true,
      tagging: false,
      searchIntegration: false,
      reporting: true,
      moderationQueue: false,
      pinnedPosts: false,
      reputationSystem: true,
      realTimeUpdates: false,
      advancedRankingAlgorithm: false,
      auditTrail: true,
    },
    limits: {
      postsPerDay: 20,
      commentsPerPost: 100,
      reportsPerDay: 10,
    }
  });
  return cachedConfig;
}

function parseUserId(userId: any): string {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof userId === 'string' && uuidRegex.test(userId)) {
    return userId;
  }
  throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, ErrorCode.BAD_REQUEST);
}

export class CommunityService {
  static async createThread(tenantId: string, userId: string, data: any) {
    const config = loadConfig();
    if (!config.enabled) {
      throw new AppError('Community platform is globally disabled', ErrorCode.FORBIDDEN);
    }

    if (!config.tiers.threads) {
      throw new AppError('Thread creation is blocked on current tier', ErrorCode.FORBIDDEN);
    }

    const thread = ThreadSchema.parse(data);
    const cleanUserId = parseUserId(userId);

    const sql = `
      INSERT INTO community_threads (tenant_id, forum_id, user_id, title, content)
      VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5)
      RETURNING *
    `;
    const params = [tenantId, thread.forum_id, cleanUserId, thread.title, thread.content];

    const rows = await withTenantQuery(sql, params, tenantId);
    if (!rows || rows.length === 0) {
      throw new AppError('Failed to record thread details', ErrorCode.INTERNAL);
    }

    return rows[0];
  }

  static async createComment(tenantId: string, userId: string, data: any) {
    const config = loadConfig();
    if (!config.enabled) {
      throw new AppError('Community platform is globally disabled', ErrorCode.FORBIDDEN);
    }

    if (!config.tiers.nestedComments) {
      throw new AppError('Comment indexing is blocked on current tier', ErrorCode.FORBIDDEN);
    }

    const comment = CommentSchema.parse(data);
    const cleanUserId = parseUserId(userId);

    const sql = `
      INSERT INTO community_comments (tenant_id, thread_id, parent_id, user_id, content)
      VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5)
      RETURNING *
    `;
    const params = [tenantId, comment.thread_id, comment.parent_id || null, cleanUserId, comment.content];

    const rows = await withTenantQuery(sql, params, tenantId);
    if (!rows || rows.length === 0) {
      throw new AppError('Failed to record comment details', ErrorCode.INTERNAL);
    }

    return rows[0];
  }

  static async voteContent(tenantId: string, userId: string, targetId: string, targetType: 'thread' | 'comment', vote: 1 | -1) {
    const config = loadConfig();
    if (!config.enabled) {
      throw new AppError('Community platform is globally disabled', ErrorCode.FORBIDDEN);
    }

    if (!config.tiers.voting) {
      throw new AppError('Voting systems are blocked on current tier', ErrorCode.FORBIDDEN);
    }

    const cleanUserId = parseUserId(userId);

    const sql = `
      INSERT INTO community_votes (tenant_id, user_id, target_id, target_type, vote)
      VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5)
      ON CONFLICT (tenant_id, user_id, target_id, target_type) 
      DO UPDATE SET vote = $5
      RETURNING *
    `;
    const params = [tenantId, cleanUserId, targetId, targetType, vote];

    const rows = await withTenantQuery(sql, params, tenantId);
    if (!rows || rows.length === 0) {
      throw new AppError('Failed to log content vote transaction', ErrorCode.INTERNAL);
    }

    return rows[0];
  }

  static async fetchForums(tenantId: string): Promise<any[]> {
    const sql = `
      SELECT id, name, description, slug, is_public, created_at 
      FROM community_forums 
      WHERE tenant_id = $1::uuid
      ORDER BY created_at DESC
      LIMIT 100
    `;
    return await withTenantQuery(sql, [tenantId], tenantId);
  }

  static async setupMockForum(tenantId: string): Promise<any> {
    const checkSql = `SELECT id FROM community_forums WHERE tenant_id = $1::uuid LIMIT 1`;
    const checkRows = await withTenantQuery(checkSql, [tenantId], tenantId);
    if (checkRows && checkRows.length > 0) {
      return checkRows[0];
    }

    const sql = `
      INSERT INTO community_forums (tenant_id, name, description, slug)
      VALUES ($1::uuid, 'General Discussion', 'Central forum for all users.', 'general')
      RETURNING *
    `;
    const rows = await withTenantQuery(sql, [tenantId], tenantId);
    return rows[0];
  }
}
