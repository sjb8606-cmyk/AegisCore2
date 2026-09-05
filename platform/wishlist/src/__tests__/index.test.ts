/**
 * @platform/wishlist
 * Express router — tested with supertest.
 * If package.json lacks supertest/@types/supertest/@types/express, add them to devDependencies.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockWithTenantQuery = vi.fn();
vi.mock('@platform/tenancy', () => ({
  withTenantQuery: (...a: unknown[]) => mockWithTenantQuery(...a),
}));
vi.mock('@platform/utils', () => ({
  AppError: class AppError extends Error {
    statusCode?: number;
    constructor(message: string, public code: string) {
      super(message);
      this.name = 'AppError';
      this.statusCode =
        code === 'NOT_FOUND' ? 404 :
        code === 'UNAUTHORIZED' ? 401 : 400;
    }
  },
  ErrorCode: {
    UNAUTHORIZED: 'UNAUTHORIZED', BAD_REQUEST: 'BAD_REQUEST', NOT_FOUND: 'NOT_FOUND',
  },
  parseUserId: (id: string) => id,
  isValidUuid: (id: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
}));
vi.mock('@platform/auth', () => ({}));

import { wishlistRouter } from '../index';

const TENANT = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';
const ITEM = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function buildApp(withAuth = true) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (withAuth) {
      (req as any).auth = { tenantId: TENANT, sub: USER };
    }
    next();
  });
  app.use(wishlistRouter);
  return app;
}

describe('wishlist router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET / returns 400 without auth context', async () => {
    const app = buildApp(false);
    const res = await request(app).get('/');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/authenticated context/i);
  });

  it('GET / returns items for caller', async () => {
    const rows = [{ id: ITEM, item_ref: 'sku-1', item_name: 'Widget' }];
    mockWithTenantQuery.mockResolvedValueOnce(rows);
    const res = await request(buildApp()).get('/');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(rows);
  });

  it('POST /items validates body and inserts', async () => {
    const row = { id: ITEM, item_ref: 'sku-1', item_name: 'Widget', priority: 'high' };
    mockWithTenantQuery.mockResolvedValueOnce([row]);
    const res = await request(buildApp())
      .post('/items')
      .send({ item_ref: 'sku-1', item_name: 'Widget', priority: 'high' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual(row);
  });

  it('POST /items rejects empty item_ref', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ item_ref: '', item_name: 'Widget' });
    expect(res.status).toBe(400);
  });

  it('PUT /items/:id returns 404 when missing', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([]);
    const res = await request(buildApp())
      .put(`/items/${ITEM}`)
      .send({ notes: 'later' });
    expect(res.status).toBe(404);
  });

  it('PUT /items/:id updates notes/priority', async () => {
    const row = { id: ITEM, notes: 'later', priority: 'low' };
    mockWithTenantQuery.mockResolvedValueOnce([row]);
    const res = await request(buildApp())
      .put(`/items/${ITEM}`)
      .send({ notes: 'later', priority: 'low' });
    expect(res.status).toBe(200);
    expect(res.body.notes).toBe('later');
  });

  it('DELETE /items/:id returns 204 on success', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([{ id: ITEM }]);
    const res = await request(buildApp()).delete(`/items/${ITEM}`);
    expect(res.status).toBe(204);
  });

  it('DELETE /items/:id returns 404 when missing', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([]);
    const res = await request(buildApp()).delete(`/items/${ITEM}`);
    expect(res.status).toBe(404);
  });
});
