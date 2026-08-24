import * as crypto from 'crypto';
import { z } from 'zod';
import {
  runCrudOperation,
  AppError,
  ErrorCode
} from '@platform/crud-kernel';
import { loadConfig } from '@platform/utils';
import { getLogger } from '@platform/observability';

const logger = getLogger('linguist-qa-review');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  minimum_accuracy_score: z.number().min(0).max(100).default(80)
});

export interface LinguistQaReview {
  review_id: string;
  project_id: string;
  reviewer_id: string;
  accuracy_score?: number;
  issues_found: string[];
  approved: boolean;
  review_notes?: string;
  created_at: string;
  updated_at: string;
}

const store = new Map<string, LinguistQaReview>();

function now(): string {
  return new Date().toISOString();
}

export async function assignReviewer(
  tenantId: string,
  actorId: string,
  projectId: string,
  reviewerId: string
): Promise<LinguistQaReview> {
  return runCrudOperation({
    configName: 'linguist-qa-review',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: 'create',
    auditAction: 'data.created',
    auditResource: 'linguist_qa_review',
    meterEventType: 'api_call',
    actionFn: async () => {
      const config = loadConfig('linguist-qa-review', ConfigSchema);

      if (!config.enabled) {
        throw new AppError(
          'Linguist QA review is disabled',
          ErrorCode.FORBIDDEN
        );
      }

      if (!projectId.trim() || !reviewerId.trim()) {
        throw new AppError(
          'Project ID and reviewer ID are required',
          ErrorCode.BAD_REQUEST
        );
      }

      const review_id = crypto.randomUUID();
      const timestamp = now();

      const review: LinguistQaReview = {
        review_id,
        project_id: projectId.trim(),
        reviewer_id: reviewerId.trim(),
        issues_found: [],
        approved: false,
        created_at: timestamp,
        updated_at: timestamp
      };

      store.set(tenantId + ':' + review_id, review);

      logger.info('QA reviewer assigned', {
        tenantId,
        projectId,
        reviewId: review_id
      });

      return review;
    }
  });
}

export async function submitReview(
  tenantId: string,
  actorId: string,
  reviewId: string,
  accuracyScore: number,
  issuesFound: string[],
  approved: boolean,
  reviewNotes?: string
): Promise<LinguistQaReview> {
  return runCrudOperation({
    configName: 'linguist-qa-review',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: 'update',
    auditAction: 'data.updated',
    auditResource: 'linguist_qa_review',
    meterEventType: 'api_call',
    actionFn: async () => {
      const config = loadConfig('linguist-qa-review', ConfigSchema);
      const key = tenantId + ':' + reviewId;
      const review = store.get(key);

      if (!review) {
        throw new AppError(
          'QA review not found',
          ErrorCode.NOT_FOUND
        );
      }

      if (accuracyScore < 0 || accuracyScore > 100) {
        throw new AppError(
          'Accuracy score must be between 0 and 100',
          ErrorCode.BAD_REQUEST
        );
      }

      if (approved && accuracyScore < config.minimum_accuracy_score) {
        throw new AppError(
          'Approved review does not meet minimum accuracy score',
          ErrorCode.BAD_REQUEST
        );
      }

      review.accuracy_score = accuracyScore;
      review.issues_found = [...issuesFound];
      review.approved = approved;
      review.review_notes = reviewNotes;
      review.updated_at = now();

      store.set(key, review);

      return review;
    }
  });
}

export function getQaHistory(
  tenantId: string,
  _actorId: string,
  linguistId: string
): LinguistQaReview[] {
  const reviews: LinguistQaReview[] = [];

  for (const [key, review] of store.entries()) {
    if (
      key.startsWith(tenantId + ':') &&
      review.reviewer_id === linguistId
    ) {
      reviews.push({ ...review });
    }
  }

  return reviews;
}

export function getQaReview(
  tenantId: string,
  reviewId: string
): LinguistQaReview | undefined {
  return store.get(tenantId + ':' + reviewId);
}

export function __resetLinguistQaReviewStore(): void {
  store.clear();
}
