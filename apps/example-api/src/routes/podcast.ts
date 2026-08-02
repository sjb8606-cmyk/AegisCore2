/**
 * apps/example-api/src/routes/podcast.ts
 *
 * Podcast — tenant-wide podcast episode catalog.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { withTenantQuery } from '../../../../platform/tenancy/src/index';
import { emit as auditEmit } from '../../../../platform/audit/src/index';
import { recordUsage } from '../../../../platform/metering/src/index';
import { requireRole, ROLES } from '../../../../platform/auth/src/index';
import { ok, created, validateBody, validateQuery, AppError, ErrorCode } from '../../../../platform/utils/src/index';
import { PaginationQuerySchema, buildPage, handleETag, decodeCursor } from '../../../../platform/utils/src/index';
import { AuthenticatedRequest } from '../../../../platform/auth/src/index';

const router = Router();

const CreateEpisodeSchema = z.object({
  title:            z.string().min(1).max(255),
  description:      z.string().max(5000).optional(),
  audioUrl:         z.string().url(),
  durationSeconds:  z.number().int().nonnegative().optional(),
  publishedAt:      z.string().datetime().optional(),
});

const EpisodeIdParamSchema = z.object({ id: z.string().uuid() });

// ── GET /items — list episodes (paginated + ETag) ───────────────

router.get('/items',
  requireRole(ROLES.VIEWER),
  validateQuery(PaginationQuerySchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const query = (req as any).validatedQuery;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;
      const cursorFilter = query.cursor ? decodeCursor(query.cursor) : null;

      const rows = await withTenantQuery<{ id: string; user_id: string; title: string; description: string | null; audio_url: string; duration_seconds: number | null; published_at: string | null; created_at: string }>(
        `SELECT id, user_id, title, description, audio_url, duration_seconds, published_at, created_at FROM podcast_episodes
         WHERE ($1::timestamptz IS NULL OR created_at ${query.sort === 'asc' ? '>' : '<'} $1::timestamptz)
         ORDER BY created_at ${query.sort === 'asc' ? 'ASC' : 'DESC'}
         LIMIT $2`,
        [cursorFilter, query.limit + 1],
        tenantId,
      );

      const page = buildPage(rows, 'created_at', query);
      if (handleETag(req, res, page)) return;

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.read', outcome: 'success', resource: 'podcast_episode', description: `Listed podcast episodes (page cursor: ${query.cursor || 'start'})` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, page.data, { pagination: page.pagination });
    } catch (err) { next(err); }
  }
);

// ── POST /items — publish an episode ────────────────────────────

router.post('/items',
  requireRole(ROLES.VIEWER),
  validateBody(CreateEpisodeSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const input = req.body as z.infer<typeof CreateEpisodeSchema>;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const rows = await withTenantQuery<{ id: string; user_id: string; title: string; description: string | null; audio_url: string; duration_seconds: number | null; published_at: string | null; created_at: string }>(
        `INSERT INTO podcast_episodes (tenant_id, user_id, title, description, audio_url, duration_seconds, published_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, user_id, title, description, audio_url, duration_seconds, published_at, created_at`,
        [tenantId, userId, input.title, input.description ?? null, input.audioUrl, input.durationSeconds ?? null, input.publishedAt ?? null],
        tenantId,
      );

      const episode = rows[0];

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.created', outcome: 'success', resource: 'podcast_episode', resourceId: episode.id, description: `Published episode '${input.title}'` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${episode.id}` });

      return created(res, episode);
    } catch (err) { next(err); }
  }
);

// ── DELETE /items/:id — remove an episode I published ───────────

router.delete('/items/:id',
  requireRole(ROLES.VIEWER),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = EpisodeIdParamSchema.parse({ id: req.params.id });
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const rows = await withTenantQuery<{ id: string }>(
        `DELETE FROM podcast_episodes WHERE id = $1 AND user_id = $2 RETURNING id`,
        [id, userId],
        tenantId,
      );

      if (rows.length === 0) {
        return next(new AppError('Episode not found or not authored by you', ErrorCode.NOT_FOUND));
      }

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.deleted', outcome: 'success', resource: 'podcast_episode', resourceId: id, description: `Removed episode ${id}` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, { id });
    } catch (err) { next(err); }
  }
);

export { router as podcastRouter };
