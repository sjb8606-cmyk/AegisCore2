import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../../../../platform/tenancy/src/index', () => ({
  withTenantQuery: vi.fn(),
}));
vi.mock('../../../../../platform/audit/src/index', () => ({
  emit: vi.fn(),
}));
vi.mock('../../../../../platform/metering/src/index', () => ({
  recordUsage: vi.fn(),
}));

import { reviewsRatingsRouter } from '../reviews-ratings';
import { withTenantQuery } from '../../../../../platform/tenancy/src/index';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const PRODUCT_ID = '33333333-3333-3333-3333-333333333333';
const REVIEW_ID = '44444444-4444-4444-4444-444444444444';

function buildTestApp(roles: string[] = ['viewer']) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { sub: USER_ID, tenantId: TENANT_ID, roles };
    next();
  });
  app.use('/reviews', reviewsRatingsRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /reviews/items', () => {
  it('creates a real review with a valid rating', async () => {
    (withTenantQuery as any).mockResolvedValue([
      { id: REVIEW_ID, user_id: USER_ID, rating: 4, title: 'Pretty good', body: null, created_at: '2026-08-01T00:00:00Z' },
    ]);

    const res = await request(buildTestApp())
      .post('/reviews/items')
      .send({ productId: PRODUCT_ID, rating: 4, title: 'Pretty good' });

    expect(res.status).toBe(201);
    expect(res.body.data.rating).toBe(4);
  });

  it('re-reviewing the same product resets a soft-deleted review rather than fabricating a duplicate', async () => {
    (withTenantQuery as any).mockResolvedValue([
      { id: REVIEW_ID, user_id: USER_ID, rating: 5, title: 'Actually great', body: null, created_at: '2026-08-01T00:00:00Z' },
    ]);

    await request(buildTestApp())
      .post('/reviews/items')
      .send({ productId: PRODUCT_ID, rating: 5, title: 'Actually great' });

    const call = (withTenantQuery as any).mock.calls[0];
    expect(call[0]).toContain('ON CONFLICT');
    expect(call[0]).toContain('deleted_at = NULL');
  });

  it('rejects a rating outside 1-5 with a real 422', async () => {
    const res = await request(buildTestApp())
      .post('/reviews/items')
      .send({ productId: PRODUCT_ID, rating: 6 });

    expect(res.status).toBe(422);
  });
});

describe('GET /reviews/items', () => {
  it('requires a real productId query param', async () => {
    const res = await request(buildTestApp()).get('/reviews/items');
    expect(res.status).toBe(400);
  });

  it('only returns non-deleted reviews for the given product', async () => {
    (withTenantQuery as any).mockResolvedValue([]);
    await request(buildTestApp()).get('/reviews/items').query({ productId: PRODUCT_ID });

    const call = (withTenantQuery as any).mock.calls[0];
    expect(call[0]).toContain('deleted_at IS NULL');
    expect(call[1][0]).toBe(PRODUCT_ID);
  });
});

describe('DELETE /reviews/items/:id', () => {
  it('soft-deletes a real review the user owns', async () => {
    (withTenantQuery as any).mockResolvedValue([{ id: REVIEW_ID }]);

    const res = await request(buildTestApp()).delete(`/reviews/items/${REVIEW_ID}`);
    expect(res.status).toBe(200);

    const call = (withTenantQuery as any).mock.calls[0];
    expect(call[0]).toContain('SET deleted_at = NOW()');
  });

  it('returns 404 for a review not owned by the caller', async () => {
    (withTenantQuery as any).mockResolvedValue([]);
    const res = await request(buildTestApp()).delete(`/reviews/items/${REVIEW_ID}`);
    expect(res.status).toBe(404);
  });
});
