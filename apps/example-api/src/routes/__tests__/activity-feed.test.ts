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

import { activityFeedRouter } from '../activity-feed';
import { withTenantQuery } from '../../../../../platform/tenancy/src/index';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_A = '22222222-2222-2222-2222-222222222222';
const USER_B = '55555555-5555-5555-5555-555555555555';
const OBJECT_ID = '33333333-3333-3333-3333-333333333333';
const ENTRY_ID = '44444444-4444-4444-4444-444444444444';

function buildTestApp(userId: string, roles: string[] = ['viewer']) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { sub: userId, tenantId: TENANT_ID, roles };
    next();
  });
  app.use('/activity-feed', activityFeedRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /activity-feed/items', () => {
  it('lists tenant-wide activity — NOT scoped to the calling user', async () => {
    (withTenantQuery as any).mockResolvedValue([
      { id: ENTRY_ID, actor_id: USER_B, verb: 'completed', object_type: 'batch', object_id: OBJECT_ID, summary: 'Completed batch', created_at: '2026-08-01T00:00:00Z' },
    ]);

    const res = await request(buildTestApp(USER_A)).get('/activity-feed/items');

    expect(res.status).toBe(200);
    expect(res.body.data[0].actor_id).toBe(USER_B);

    const call = (withTenantQuery as any).mock.calls[0];
    expect(call[0]).not.toContain('actor_id = $');
  });
});

describe('POST /activity-feed/items', () => {
  it('records a real activity entry with the real caller as actor', async () => {
    (withTenantQuery as any).mockResolvedValue([
      { id: ENTRY_ID, actor_id: USER_A, verb: 'completed', object_type: 'batch', object_id: OBJECT_ID, summary: 'Completed batch', created_at: '2026-08-01T00:00:00Z' },
    ]);

    const res = await request(buildTestApp(USER_A))
      .post('/activity-feed/items')
      .send({ verb: 'completed', objectType: 'batch', objectId: OBJECT_ID, summary: 'Completed batch' });

    expect(res.status).toBe(201);
    expect(res.body.data.actor_id).toBe(USER_A);
  });

  it('returns a real 422 for an invalid body', async () => {
    const res = await request(buildTestApp(USER_A))
      .post('/activity-feed/items')
      .send({ verb: 'completed' });

    expect(res.status).toBe(422);
  });
});

describe('DELETE /activity-feed/items/:id', () => {
  it('deletes an entry the caller authored', async () => {
    (withTenantQuery as any).mockResolvedValue([{ id: ENTRY_ID }]);

    const res = await request(buildTestApp(USER_A)).delete(`/activity-feed/items/${ENTRY_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(ENTRY_ID);
  });

  it('returns 404 when the entry was authored by someone else', async () => {
    (withTenantQuery as any).mockResolvedValue([]);

    const res = await request(buildTestApp(USER_A)).delete(`/activity-feed/items/${ENTRY_ID}`);
    expect(res.status).toBe(404);
  });
});
