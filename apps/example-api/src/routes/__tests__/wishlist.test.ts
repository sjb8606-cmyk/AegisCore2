import express from 'express';
import request from 'supertest';

jest.mock('../../../../../platform/tenancy/src/index', () => ({
  withTenantQuery: jest.fn(),
}));
jest.mock('../../../../../platform/audit/src/index', () => ({
  emit: jest.fn(),
}));
jest.mock('../../../../../platform/metering/src/index', () => ({
  recordUsage: jest.fn(),
}));

import { wishlistRouter } from '../wishlist';
import { withTenantQuery } from '../../../../../platform/tenancy/src/index';
import { emit as auditEmit } from '../../../../../platform/audit/src/index';
import { recordUsage } from '../../../../../platform/metering/src/index';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const PRODUCT_ID = '33333333-3333-3333-3333-333333333333';
const ITEM_ID = '44444444-4444-4444-4444-444444444444';

function buildTestApp(roles: string[] = ['viewer']) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { sub: USER_ID, tenantId: TENANT_ID, roles };
    next();
  });
  app.use('/wishlist', wishlistRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /wishlist/items', () => {
  it('returns a real paginated list and records real audit + usage events', async () => {
    (withTenantQuery as any).mockResolvedValue([
      { id: ITEM_ID, product_id: PRODUCT_ID, product_name: 'Widget', note: null, created_at: '2026-08-01T00:00:00Z' },
    ]);

    const res = await request(buildTestApp()).get('/wishlist/items');

    expect(res.status).toBe(200);
    expect(res.body.data[0].product_name).toBe('Widget');
    expect(auditEmit).toHaveBeenCalledWith(expect.objectContaining({ action: 'data.read', tenantId: TENANT_ID }));
    expect(recordUsage).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT_ID, eventType: 'api_call' }));
  });

  it('rejects a caller with no valid role (real RBAC, not mocked)', async () => {
    const res = await request(buildTestApp([])).get('/wishlist/items');
    expect(res.status).toBe(403);
  });
});

describe('POST /wishlist/items', () => {
  it('adds a real item and returns 201, wrapped in the real success envelope', async () => {
    (withTenantQuery as any).mockResolvedValue([
      { id: ITEM_ID, product_id: PRODUCT_ID, product_name: 'Widget', note: 'birthday gift', created_at: '2026-08-01T00:00:00Z' },
    ]);

    const res = await request(buildTestApp())
      .post('/wishlist/items')
      .send({ productId: PRODUCT_ID, productName: 'Widget', note: 'birthday gift' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.product_name).toBe('Widget');
    expect(auditEmit).toHaveBeenCalledWith(expect.objectContaining({ action: 'data.created' }));
  });

  it('rejects an invalid body with a real 422 (real Zod validation, not mocked)', async () => {
    const res = await request(buildTestApp())
      .post('/wishlist/items')
      .send({ productId: 'not-a-uuid' });

    expect(res.status).toBe(422);
    expect(withTenantQuery).not.toHaveBeenCalled();
  });
});

describe('DELETE /wishlist/items/:id', () => {
  it('deletes a real item and returns the id, wrapped in the real success envelope', async () => {
    (withTenantQuery as any).mockResolvedValue([{ id: ITEM_ID }]);

    const res = await request(buildTestApp()).delete(`/wishlist/items/${ITEM_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(ITEM_ID);
    expect(auditEmit).toHaveBeenCalledWith(expect.objectContaining({ action: 'data.deleted' }));
  });

  it('returns 404 when the item does not exist (or belongs to someone else)', async () => {
    (withTenantQuery as any).mockResolvedValue([]);

    const res = await request(buildTestApp()).delete(`/wishlist/items/${ITEM_ID}`);
    expect(res.status).toBe(404);
  });
});
