import { withTenantQuery } from '@platform/tenancy';
import * as fs from 'fs';
import * as path from 'path';
import { AppError, ErrorCode } from '@platform/utils';

export function parseUserId(userId: any): string {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof userId === 'string' && uuidRegex.test(userId)) return userId;
  throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, ErrorCode.BAD_REQUEST);
}

function loadConfig() {
  const configPath = path.join(process.cwd(), 'config', 'ai-moderation.json');
  try {
    if (fs.existsSync(configPath)) return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return {
    enabled: true,
    limits: { moderationsPerMonth: 1000 },
    thresholds: { autoApprove: 0.8, autoReject: 0.3, humanReview: 0.5 }
  };
}

export function redactPiiText(text: string): string {
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  return text.replace(emailRegex, '[REDACTED_EMAIL]');
}

export async function moderateContent(tenantId: string, userId: string, data: any) {
  const cfg = loadConfig();
  if (!cfg.enabled) throw new AppError('AI Moderation vertical is disabled', ErrorCode.FORBIDDEN);

  const cleanUserId = parseUserId(userId);

  const countRes = await withTenantQuery('SELECT COUNT(*) as count FROM moderation_items WHERE tenant_id = $1', [tenantId], tenantId);
  if (parseInt(countRes[0]?.count || '0', 10) >= cfg.limits.moderationsPerMonth) {
    throw new AppError('Monthly content screening quota reached', ErrorCode.RATE_LIMITED);
  }

  const rawText = data.contentText || '';
  const sanitizedText = redactPiiText(rawText);

  // Threshold Routing Engine: high score means "safe", low score means "unsafe"
  let score = 0.95; // default safe
  let categoriesFailed: string[] = [];

  if (sanitizedText.toLowerCase().includes('spam') || sanitizedText.toLowerCase().includes('cash')) {
    score = 0.45; // Marginal review trigger
    categoriesFailed.push('spam');
  }
  if (sanitizedText.toLowerCase().includes('hate') || sanitizedText.toLowerCase().includes('violence')) {
    score = 0.15; // Auto reject trigger
    categoriesFailed.push('hate');
  }

  let status: 'approved' | 'rejected' | 'review' = 'approved';
  if (score <= cfg.thresholds.autoReject) {
    status = 'rejected';
  } else if (score < cfg.thresholds.autoApprove) {
    status = 'review';
  }

  const moderationId = crypto.randomUUID();
  const contentId = data.contentId || crypto.randomUUID();

  const insertQuery = `
    INSERT INTO moderation_items (id, tenant_id, content_type, content_id, content_text, status, score, categories_failed, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text[], $9) RETURNING *;
  `;
  const result = await withTenantQuery(insertQuery, [
    moderationId, tenantId, data.contentType || 'post', contentId, sanitizedText, status, score, categoriesFailed, cleanUserId
  ], tenantId);

  return result[0];
}

export async function resolveReview(tenantId: string, moderationId: string, action: 'approve' | 'reject', reason: string, adminId: string) {
  const cleanAdminId = parseUserId(adminId);

  // Atomic locked lookup of moderation item
  const itemRes = await withTenantQuery('SELECT status FROM moderation_items WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [moderationId, tenantId], tenantId);
  const item = itemRes[0];
  if (!item) throw new AppError('Content screening ticket not found', ErrorCode.NOT_FOUND);

  const nextStatus = action === 'approve' ? 'approved' : 'rejected';
  const actionId = crypto.randomUUID();

  // Log immutable history action
  await withTenantQuery(`
    INSERT INTO moderation_actions (id, tenant_id, moderation_id, action, reason, processed_by)
    VALUES ($1, $2, $3, $4, $5, $6);
  `, [actionId, tenantId, moderationId, action, reason, cleanAdminId], tenantId);

  // Update original status
  const updatedItem = await withTenantQuery(`
    UPDATE moderation_items 
    SET status = $1, updated_at = CURRENT_TIMESTAMP
    WHERE id = $2 AND tenant_id = $3 RETURNING *;
  `, [nextStatus, moderationId, tenantId], tenantId);

  return updatedItem[0];
}

export async function getModerationDetails(tenantId: string, id: string) {
  const res = await withTenantQuery('SELECT * FROM moderation_items WHERE id = $1 AND tenant_id = $2', [id, tenantId], tenantId);
  const item = res[0];
  if (!item) throw new AppError('Screening details not found', ErrorCode.NOT_FOUND);

  const actions = await withTenantQuery('SELECT id, action, reason, processed_by FROM moderation_actions WHERE moderation_id = $1 AND tenant_id = $2', [id, tenantId], tenantId);
  return { ...item, actions };
}
