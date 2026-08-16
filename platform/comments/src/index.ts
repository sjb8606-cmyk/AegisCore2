import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { withTenantQuery } from '@platform/tenancy';
import { AppError, ErrorCode, parseUserId, isValidUuid } from '@platform/utils';
import { AuthenticatedRequest } from '@platform/auth';

export const CreateCommentSchema = z.object({
  resource_type: z.string().min(1).max(100),
  resource_id: z.string().min(1).max(255),
  body: z.string().min(1).max(5000),
});

export const UpdateCommentSchema = z.object({
  body: z.string().min(1).max(5000),
});

function extractContext(req: Request) {
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth) throw new AppError('Missing authenticated context', ErrorCode.UNAUTHORIZED);
  return { tenantId: auth.tenantId, userId: parseUserId(auth.sub) };
}

const router = Router();

// ── List comments for a resource ─────────────────────────────────
// GET /api/comments?resource_type=item&resource_id=<id>

router.get(['/', '/api/comments'], async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const resourceType = String(req.query.resource_type || '');
    const resourceId = String(req.query.resource_id || '');
    if (!resourceType || !resourceId) {
      throw new AppError('resource_type and resource_id are required', ErrorCode.BAD_REQUEST);
    }
    const rows = await withTenantQuery(
      `SELECT * FROM comments
       WHERE tenant_id = $1 AND resource_type = $2 AND resource_id = $3 AND deleted_at IS NULL
       ORDER BY created_at ASC`,
      [tenantId, resourceType, resourceId], tenantId
    );
    res.json(rows);
  } catch (err: any) {
    const status = err instanceof AppError ? err.statusCode ?? 400 : 400;
    res.status(status).json({ error: err.message });
  }
});

// ── Create a comment ──────────────────────────────────────────────

router.post(['/', '/api/comments'], async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const input = CreateCommentSchema.parse(req.body);
    const result = await withTenantQuery(
      `INSERT INTO comments (tenant_id, user_id, resource_type, resource_id, body, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING *`,
      [tenantId, userId, input.resource_type, input.resource_id, input.body], tenantId
    );
    res.status(201).json(result[0]);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

// ── Edit a comment (author only) ──────────────────────────────────

router.put(['/:id', '/api/comments/:id'], async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const { id } = req.params;
    if (!isValidUuid(id)) throw new AppError('Invalid comment id', ErrorCode.BAD_REQUEST);
    const input = UpdateCommentSchema.parse(req.body);
    const result = await withTenantQuery(
      `UPDATE comments SET body = $3, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2 AND user_id = $4 AND deleted_at IS NULL
       RETURNING *`,
      [id, tenantId, input.body, userId], tenantId
    );
    if (result.length === 0) throw new AppError('Comment not found', ErrorCode.NOT_FOUND);
    res.json(result[0]);
  } catch (err: any) {
    const status = err instanceof AppError ? err.statusCode ?? 400 : 400;
    res.status(status).json({ error: err.message });
  }
});

// ── Soft-delete a comment (author only) ───────────────────────────

router.delete(['/:id', '/api/comments/:id'], async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const { id } = req.params;
    if (!isValidUuid(id)) throw new AppError('Invalid comment id', ErrorCode.BAD_REQUEST);
    const result = await withTenantQuery(
      `UPDATE comments SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2 AND user_id = $3 AND deleted_at IS NULL
       RETURNING id`,
      [id, tenantId, userId], tenantId
    );
    if (result.length === 0) throw new AppError('Comment not found', ErrorCode.NOT_FOUND);
    res.status(204).send();
  } catch (err: any) {
    const status = err instanceof AppError ? err.statusCode ?? 400 : 400;
    res.status(status).json({ error: err.message });
  }
});

export { router as commentsRouter };
