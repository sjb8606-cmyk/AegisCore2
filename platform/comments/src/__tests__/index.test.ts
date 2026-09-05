import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('@platform/tenancy', () => ({
  withTenantQuery: vi.fn(),
}));

import { commentsRouter } from '../index';
import { withTenantQuery } from '@platform/tenancy';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const OTHER_USER_ID = '33333333-3333-3333-3333-333333333333';
const COMMENT_ID = '44444444-4444-4444-4444-444444444444';

function buildApp(auth: { tenantId: string; sub: string } | null) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    if (auth) req.auth = { tenantId: auth.tenantId, sub: auth.sub };
    next();
  });
  app.use(commentsRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /', () => {
  it('returns 401 with no authenticated context', async () => {
    const app = buildApp(null);
    const res = await request(app).get('/').query({ resource_type: 'ticket', resource_id: 't1' });
    expect(res.status).toBe(401);
    expect(withTenantQuery).not.toHaveBeenCalled();
  });

  it('returns 400 when resource_type or resource_id is missing', async () => {
    const app = buildApp({ tenantId: TENANT_ID, sub: USER_ID });
    const res = await request(app).get('/').query({ resource_type: 'ticket' });
    expect(res.status).toBe(400);
  });

  it('returns comments scoped to tenant/resource', async () => {
    const rows = [{ id: COMMENT_ID, body: 'hello' }];
    (withTenantQuery as any).mockResolvedValueOnce(rows);
    const app = buildApp({ tenantId: TENANT_ID, sub: USER_ID });
    const res = await request(app).get('/').query({ resource_type: 'ticket', resource_id: 't1' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(rows);
  });
});

describe('POST /', () => {
  // INCONSISTENCY — documented, not hidden. Unlike GET/PUT/DELETE, this
  // route's catch block hardcodes res.status(400) regardless of the error
  // type, instead of mapping AppError.statusCode like the other three
  // handlers do. A missing-auth-context error should be 401, not 400.
  it('INCONSISTENCY: returns 400 (not 401) with no authenticated context, unlike the other 3 routes', async () => {
    const app = buildApp(null);
    const res = await request(app).post('/').send({ resource_type: 'ticket', resource_id: 't1', body: 'hi' });
    expect(res.status).toBe(400);
    expect(withTenantQuery).not.toHaveBeenCalled();
    // TODO(comments bug): POST's catch block should mirror GET/PUT/DELETE's
    // `err instanceof AppError ? err.statusCode ?? 400 : 400` pattern.
  });

  it('rejects a body over 5000 characters via schema validation', async () => {
    const app = buildApp({ tenantId: TENANT_ID, sub: USER_ID });
    const res = await request(app)
      .post('/')
      .send({ resource_type: 'ticket', resource_id: 't1', body: 'x'.repeat(5001) });
    expect(res.status).toBe(400);
    expect(withTenantQuery).not.toHaveBeenCalled();
  });

  it('creates a comment and returns 201 with the inserted row', async () => {
    const row = { id: COMMENT_ID, body: 'hello', user_id: USER_ID };
    (withTenantQuery as any).mockResolvedValueOnce([row]);
    const app = buildApp({ tenantId: TENANT_ID, sub: USER_ID });
    const res = await request(app).post('/').send({ resource_type: 'ticket', resource_id: 't1', body: 'hello' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual(row);
  });
});

describe('PUT /:id', () => {
  it('rejects a malformed comment id', async () => {
    const app = buildApp({ tenantId: TENANT_ID, sub: USER_ID });
    const res = await request(app).put('/not-a-uuid').send({ body: 'edited' });
    expect(res.status).toBe(400);
    expect(withTenantQuery).not.toHaveBeenCalled();
  });

  it('returns 404 when editing a comment authored by someone else (or that does not exist)', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);
    const app = buildApp({ tenantId: TENANT_ID, sub: OTHER_USER_ID });
    const res = await request(app).put(`/${COMMENT_ID}`).send({ body: 'edited' });
    expect(res.status).toBe(404);
  });

  it('updates the body and returns the updated row for the original author', async () => {
    const row = { id: COMMENT_ID, body: 'edited', user_id: USER_ID };
    (withTenantQuery as any).mockResolvedValueOnce([row]);
    const app = buildApp({ tenantId: TENANT_ID, sub: USER_ID });
    const res = await request(app).put(`/${COMMENT_ID}`).send({ body: 'edited' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(row);
  });
});

describe('DELETE /:id', () => {
  it('returns 404 when deleting a comment authored by someone else (or that does not exist)', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);
    const app = buildApp({ tenantId: TENANT_ID, sub: OTHER_USER_ID });
    const res = await request(app).delete(`/${COMMENT_ID}`);
    expect(res.status).toBe(404);
  });

  it('soft-deletes and returns 204 for the original author', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: COMMENT_ID }]);
    const app = buildApp({ tenantId: TENANT_ID, sub: USER_ID });
    const res = await request(app).delete(`/${COMMENT_ID}`);
    expect(res.status).toBe(204);
  });
});
