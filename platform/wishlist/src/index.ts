import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { withTenantQuery } from '@platform/tenancy';
import { AppError, ErrorCode } from '@platform/utils';
import { AuthenticatedRequest } from '@platform/auth';

export const AddWishlistItemSchema = z.object({
  item_ref: z.string().min(1).max(255),
  item_name: z.string().min(1).max(255),
  notes: z.string().max(2000).optional(),
  priority: z.enum(['low', 'normal', 'high']).optional(),
});

export const UpdateWishlistItemSchema = z.object({
  notes: z.string().max(2000).optional(),
  priority: z.enum(['low', 'normal', 'high']).optional(),
});

export function isValidUuid(id: any): boolean {
  return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}
export function parseUserId(userId: any): string {
  if (isValidUuid(userId)) return userId;
  throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, ErrorCode.BAD_REQUEST);
}

function extractContext(req: Request) {
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth) throw new AppError('Missing authenticated context', ErrorCode.UNAUTHORIZED);
  return { tenantId: auth.tenantId, userId: parseUserId(auth.sub) };
}

const router = Router();

// ── List the caller's wishlist ──────────────────────────────────

router.get(['/', '/api/wishlist'], async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const rows = await withTenantQuery(
      `SELECT * FROM wishlist_items WHERE tenant_id = $1 AND user_id = $2 ORDER BY created_at DESC`,
      [tenantId, userId], tenantId
    );
    res.json(rows);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

// ── Add an item ──────────────────────────────────────────────────

router.post(['/items', '/api/wishlist/items'], async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const input = AddWishlistItemSchema.parse(req.body);
    const result = await withTenantQuery(
      `INSERT INTO wishlist_items (tenant_id, user_id, item_ref, item_name, notes, priority, updated_at)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'normal'), NOW())
       ON CONFLICT (tenant_id, user_id, item_ref) DO UPDATE SET
         item_name = $4,
         notes = COALESCE($5, wishlist_items.notes),
         priority = COALESCE($6, wishlist_items.priority),
         updated_at = NOW()
       RETURNING *`,
      [tenantId, userId, input.item_ref, input.item_name, input.notes ?? null, input.priority ?? null], tenantId
    );
    res.status(201).json(result[0]);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

// ── Update an item (notes / priority) ────────────────────────────

router.put(['/items/:id', '/api/wishlist/items/:id'], async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const { id } = req.params;
    if (!isValidUuid(id)) throw new AppError('Invalid item id', ErrorCode.BAD_REQUEST);
    const input = UpdateWishlistItemSchema.parse(req.body);
    const result = await withTenantQuery(
      `UPDATE wishlist_items SET
         notes = COALESCE($3, notes),
         priority = COALESCE($4, priority),
         updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2 AND user_id = $5
       RETURNING *`,
      [id, tenantId, input.notes ?? null, input.priority ?? null, userId], tenantId
    );
    if (result.length === 0) throw new AppError('Wishlist item not found', ErrorCode.NOT_FOUND);
    res.json(result[0]);
  } catch (err: any) {
    const status = err instanceof AppError ? err.statusCode ?? 400 : 400;
    res.status(status).json({ error: err.message });
  }
});

// ── Remove an item ────────────────────────────────────────────────

router.delete(['/items/:id', '/api/wishlist/items/:id'], async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const { id } = req.params;
    if (!isValidUuid(id)) throw new AppError('Invalid item id', ErrorCode.BAD_REQUEST);
    const result = await withTenantQuery(
      `DELETE FROM wishlist_items WHERE id = $1 AND tenant_id = $2 AND user_id = $3 RETURNING id`,
      [id, tenantId, userId], tenantId
    );
    if (result.length === 0) throw new AppError('Wishlist item not found', ErrorCode.NOT_FOUND);
    res.status(204).send();
  } catch (err: any) {
    const status = err instanceof AppError ? err.statusCode ?? 400 : 400;
    res.status(status).json({ error: err.message });
  }
});

export { router as wishlistRouter };
