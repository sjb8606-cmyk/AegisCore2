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

import { mentionsRouter } from '../mentions';
import { withTenantQuery } from '../../../../../platform/tenancy/src/index';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const MENTIONED_USER_ID = '22222222-2222-2222-2222-222222222222';
const MENTIONING_USER_ID = '55555555-5555-5555-5555-555555555555';
const RESOURCE_ID = '33333333-3333-3333-3333-333333333333';
const MENTION_ID = '44444444-4444-4444-4444-444444444444';

function buildTestApp(userId: string, roles: string[] = ['viewer']) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { sub: userId, tenantId: TENANT_ID, roles };
    next();
  });
  app.use('/mentions', mentionsRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /mentions/items', () => {
  it('lists mentions scoped to the current user as the MENTIONED party, not the creator', async () => {
    (withTenantQuery as any).mockResolvedValue([]);

    await request(buildTestApp(MENTIONED_USER_ID)).get('/mentions/items');

    const call = (withTenantQuery as any).mock.calls[0];
    expect(call[1][0]).toBe(MENTIONED_USER_ID);
  });
});

describe('POST /mentions/items', () => {
  it('creates a mention with the creator recorded separately from the mentioned user', async () => {
    (withTenantQuery as any).mockResolvedValue([
      { id: MENTION_ID, mentioned_by_user_id: MENTIONING_USER_ID, resource_type: 'batch', resource_id: RESOURCE_ID, context_snippet: null, created_at: '2026-08-01T00:00:00Z' },
    ]);

    const res = await request(buildTestApp(MENTIONING_USER_ID))
      .post('/mentions/items')
      .send({ mentionedUserId: MENTIONED_USER_ID, resourceType: 'batch', resourceId: RESOURCE_ID });

    expect(res.status).toBe(201);
    const call = (withTenantQuery as any).mock.calls[0];
    expect(call[1][1]).toBe(MENTIONED_USER_ID);
    expect(call[1][2]).toBe(MENTIONING_USER_ID);
  });
});

describe('DELETE /mentions/items/:id', () => {
  it('lets the MENTIONED user dismiss their own mention', async () => {
    (withTenantQuery as any).mockResolvedValue([{ id: MENTION_ID }]);

    const res = await request(buildTestApp(MENTIONED_USER_ID)).delete(`/mentions/items/${MENTION_ID}`);

    expect(res.status).toBe(200);
    const call = (withTenantQuery as any).mock.calls[0];
    expect(call[1][1]).toBe(MENTIONED_USER_ID);
  });

  it('does NOT let the person who created the mention dismiss it (they are not the owner of the dismissal)', async () => {
    (withTenantQuery as any).mockResolvedValue([]);

    const res = await request(buildTestApp(MENTIONING_USER_ID)).delete(`/mentions/items/${MENTION_ID}`);
    expect(res.status).toBe(404);
  });
});
