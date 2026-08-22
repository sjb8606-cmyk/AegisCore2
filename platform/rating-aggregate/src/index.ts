/**
 * platform/rating-aggregate
 *
 * Per-entity ratings + cached average/count on the parent.
 * Optional one-rating-per-user enforcement.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('rating-aggregate');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  supportedEntityTypes: z.array(z.string()).default(['*']),
  onePerUser: z.boolean().default(true),
  minScore: z.number().default(1),
  maxScore: z.number().default(5),
});

export interface Rating {
  id: string;
  tenantId: string;
  entityType: string;
  entityId: string;
  userId: string;
  score: number;
  comment: string | null;
  createdAt: string;
}

export interface EntityRatingCache {
  tenantId: string;
  entityType: string;
  entityId: string;
  averageRating: number;
  ratingCount: number;
  updatedAt: string;
}

const ratings = new Map<string, Rating>();
const cache = new Map<string, EntityRatingCache>(); // tenant:type:entityId

export function __resetRatingAggregateStore(): void {
  ratings.clear();
  cache.clear();
}

function cacheKey(
  tenantId: string,
  entityType: string,
  entityId: string,
): string {
  return tenantId + ':' + entityType + ':' + entityId;
}

async function loadCfg() {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('rating-aggregate', ConfigSchema);
}

function recompute(
  tenantId: string,
  entityType: string,
  entityId: string,
): EntityRatingCache {
  const list = [...ratings.values()].filter(
    (r) =>
      r.tenantId === tenantId &&
      r.entityType === entityType &&
      r.entityId === entityId,
  );
  const count = list.length;
  const avg =
    count === 0
      ? 0
      : Math.round(
          (list.reduce((s, r) => s + r.score, 0) / count) * 1000,
        ) / 1000;
  const entry: EntityRatingCache = {
    tenantId,
    entityType,
    entityId,
    averageRating: avg,
    ratingCount: count,
    updatedAt: new Date().toISOString(),
  };
  cache.set(cacheKey(tenantId, entityType, entityId), entry);
  return entry;
}

export async function createRating(
  tenantId: string,
  actorId: string,
  input: {
    entityType: string;
    entityId: string;
    userId: string;
    score: number;
    comment?: string;
  },
): Promise<{ rating: Rating; aggregate: EntityRatingCache }> {
  return runCrudOperation({
    configName: 'rating-aggregate',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      if (!input.entityType || !input.entityId || !input.userId) {
        throw new AppError(
          'entityType, entityId, userId required',
          ErrorCode.BAD_REQUEST,
        );
      }
      if (
        !config.supportedEntityTypes.includes('*') &&
        !config.supportedEntityTypes.includes(input.entityType)
      ) {
        throw new AppError(
          'entity type not rateable',
          ErrorCode.FORBIDDEN,
        );
      }
      if (
        typeof input.score !== 'number' ||
        input.score < config.minScore ||
        input.score > config.maxScore
      ) {
        throw new AppError(
          'score must be between ' +
            config.minScore +
            ' and ' +
            config.maxScore,
          ErrorCode.BAD_REQUEST,
        );
      }
      if (config.onePerUser) {
        const existing = [...ratings.values()].find(
          (r) =>
            r.tenantId === tenantId &&
            r.entityType === input.entityType &&
            r.entityId === input.entityId &&
            r.userId === input.userId,
        );
        if (existing) {
          throw new AppError(
            'User already rated this entity',
            ErrorCode.CONFLICT,
          );
        }
      }
      const rating: Rating = {
        id: crypto.randomUUID(),
        tenantId,
        entityType: input.entityType,
        entityId: input.entityId,
        userId: input.userId,
        score: input.score,
        comment: input.comment?.trim() || null,
        createdAt: new Date().toISOString(),
      };
      ratings.set(rating.id, rating);
      const aggregate = recompute(
        tenantId,
        input.entityType,
        input.entityId,
      );
      logger.info(
        { entityId: input.entityId, avg: aggregate.averageRating },
        'Rating created',
      );
      return { rating, aggregate };
    },
    auditAction: 'data.created',
    auditResource: 'rating',
    meterEventType: 'api_call',
  });
}

export async function deleteRating(
  tenantId: string,
  actorId: string,
  ratingId: string,
): Promise<EntityRatingCache> {
  return runCrudOperation({
    configName: 'rating-aggregate',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const rating = ratings.get(ratingId);
      if (!rating || rating.tenantId !== tenantId) {
        throw new AppError('Rating not found', ErrorCode.NOT_FOUND);
      }
      ratings.delete(ratingId);
      return recompute(tenantId, rating.entityType, rating.entityId);
    },
    auditAction: 'data.deleted',
    auditResource: 'rating',
    meterEventType: 'api_call',
  });
}

export async function getAggregate(
  tenantId: string,
  entityType: string,
  entityId: string,
): Promise<EntityRatingCache> {
  const k = cacheKey(tenantId, entityType, entityId);
  const existing = cache.get(k);
  if (existing) return existing;
  return recompute(tenantId, entityType, entityId);
}

export async function listRatings(
  tenantId: string,
  entityType: string,
  entityId: string,
): Promise<Rating[]> {
  return [...ratings.values()].filter(
    (r) =>
      r.tenantId === tenantId &&
      r.entityType === entityType &&
      r.entityId === entityId,
  );
}
