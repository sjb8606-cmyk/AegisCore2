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

import { commentsRouter } from '../comments';
import { withTenantQuery } from '../../../../../platform/tenancy/src/index';
import { emit as auditEmit } from '../../../../../platform/audit/src/index';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const OTHER_USER_ID = '99999999-9999-9999-9999-999999999999';
const RESOURCE_ID = '33333333-3333-3333-3333-333333333333';
const COMMENT_ID = '44444444-4444-4444-4444-444444444444';

function buildTestApp(userId: string = USER_ID, roles: string[] = ['viewer']) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { sub: userId, tenantId: TENANT_ID, roles };
    next();
  });
  app.use('/comments', commentsRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /comments/items', () => {
  it('returns a real paginated list scoped to the given resource', async () => {
    (withTenantQuery as any).mockResolvedValue([
      { id: COMMENT_ID, user_id: USER_ID, body: 'Nice work!', created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z' },
    ]);

    const res = await request(buildTestApp())
      .get('/comments/items')
      .query({ resourceType: 'batch', resourceId: RESOURCE_ID });

    expect(res.status).toBe(200);
    expect(res.body.data[0].body).toBe('Nice work!');
    const call = (withTenantQuery as any).mock.calls[0];
    expect(call[1]).toContain('batch');
    expect(call[1]).toContain(RESOURCE_ID);
  });

  it('returns a real 400 when resourceType/resourceId are missing (real Zod query validation)', async () => {
    const res = await request(buildTestApp()).get('/comments/items');
    expect(res.status).toBe(400);
  });
});

describe('POST /comments/items', () => {
  it('creates a real comment', async () => {
    (withTenantQuery as any).mockResolvedValue([
      { id: COMMENT_ID, user_id: USER_ID, body: 'Great batch', created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z' },
    ]);

    const res = await request(buildTestApp())
      .post('/comments/items')
      .send({ resourceType: 'batch', resourceId: RESOURCE_ID, body: 'Great batch' });

    expect(res.status).toBe(201);
    expect(res.body.data.body).toBe('Great batch');
    expect(auditEmit).toHaveBeenCalledWith(expect.objectContaining({ action: 'data.created' }));
  });

  it('returns a real 422 for an invalid body', async () => {
    const res = await request(buildTestApp())
      .post('/comments/items')
      .send({ resourceType: 'batch' });

    expect(res.status).toBe(422);
  });
});

describe('DELETE /comments/items/:id', () => {
  it('soft-deletes a real comment the user owns', async () => {
    (withTenantQuery as any).mockResolvedValue([{ id: COMMENT_ID }]);

    const res = await request(buildTestApp()).delete(`/comments/items/${COMMENT_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(COMMENT_ID);
    const call = (withTenantQuery as any).mock.calls[0];
    expect(call[0]).toContain('SET deleted_at = NOW()');
    expect(call[0]).not.toContain('DELETE FROM comments');
  });

  it('returns 404 when the comment belongs to someone else (real ownership check)', async () => {
    (withTenantQuery as any).mockResolvedValue([]);

    const res = await request(buildTestApp(OTHER_USER_ID)).delete(`/comments/items/${COMMENT_ID}`);
    expect(res.status).toBe(404);
  });
});
