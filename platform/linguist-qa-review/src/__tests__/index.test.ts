import { describe, expect, it, beforeEach, vi } from 'vitest';

vi.mock('@platform/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platform/utils')>();
  return {
    ...actual,
  loadConfig: vi.fn(() => ({
    enabled: true,
    minimum_accuracy_score: 80
    }))
  };
});

vi.mock('@platform/observability', () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }))
}));

vi.mock('@platform/crud-kernel', () => ({
  runCrudOperation: vi.fn(async (options: any) => options.actionFn()),
  AppError: class AppError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  },
  ErrorCode: {
    BAD_REQUEST: 'BAD_REQUEST',
    NOT_FOUND: 'NOT_FOUND',
    FORBIDDEN: 'FORBIDDEN',
    CONFLICT: 'CONFLICT'
  }
}));

import {
  assignReviewer,
  submitReview,
  getQaHistory,
  getQaReview,
  __resetLinguistQaReviewStore
} from '../index';

describe('linguist-qa-review', () => {
  beforeEach(() => {
    __resetLinguistQaReviewStore();
  });

  it('assigns a reviewer to a translation project', async () => {
    const review = await assignReviewer(
      'tenant-1',
      'actor-1',
      'project-1',
      'reviewer-1'
    );

    expect(review.project_id).toBe('project-1');
    expect(review.reviewer_id).toBe('reviewer-1');
    expect(review.approved).toBe(false);
    expect(getQaReview('tenant-1', review.review_id)).toEqual(review);
  });

  it('submits an approved review with a passing score', async () => {
    const review = await assignReviewer(
      'tenant-1',
      'actor-1',
      'project-1',
      'reviewer-1'
    );

    const submitted = await submitReview(
      'tenant-1',
      'actor-1',
      review.review_id,
      95,
      [],
      true,
      'Accurate translation.'
    );

    expect(submitted.accuracy_score).toBe(95);
    expect(submitted.approved).toBe(true);
    expect(submitted.review_notes).toBe('Accurate translation.');
  });

  it('rejects approval below the configured minimum score', async () => {
    const review = await assignReviewer(
      'tenant-1',
      'actor-1',
      'project-1',
      'reviewer-1'
    );

    await expect(
      submitReview(
        'tenant-1',
        'actor-1',
        review.review_id,
        70,
        ['Terminology issue'],
        true
      )
    ).rejects.toThrow(
      'Approved review does not meet minimum accuracy score'
    );

    expect(getQaHistory('tenant-1', 'actor-1', 'reviewer-1')).toHaveLength(1);
  });
});
