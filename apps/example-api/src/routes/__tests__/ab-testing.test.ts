import express from 'express';
import request from 'supertest';

jest.mock('../../../../../platform/tenancy/src/index', () => ({
  withTenantQuery: jest.fn(),
}));
jest.mock('../../../../../platform/audit/src/index', () => ({
  emit: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../../../../platform/metering/src/index', () => ({
  recordUsage: jest.fn().mockResolvedValue(undefined),
}));

import { withTenantQuery } from '../../../../../platform/tenancy/src/index';
import { abTestingRouter } from '../ab-testing';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const EXPERIMENT_ID = '33333333-3333-3333-3333-333333333333';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { sub: USER_ID, tenantId: TENANT_ID, roles: ['viewer'] };
    next();
  });
  app.use('/', abTestingRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  });
  return app;
}

describe('ab-testing routes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('POST /items creates an experiment when variant weights sum to 1', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: EXPERIMENT_ID, name: 'Checkout button color', variants: [{ name: 'control', weight: 0.5 }, { name: 'variant', weight: 0.5 }], status: 'draft', started_at: null, ended_at: null, created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp())
      .post('/items')
      .send({ name: 'Checkout button color', variants: [{ name: 'control', weight: 0.5 }, { name: 'variant', weight: 0.5 }] });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Checkout button color');
    expect(res.body.data.id).toBe(EXPERIMENT_ID);
  });

  it('POST /items returns 422 when variant weights do not sum to 1', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ name: 'Bad experiment', variants: [{ name: 'control', weight: 0.5 }, { name: 'variant', weight: 0.3 }] });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/sum to 1/);
    // this rejection happens after Zod passes, inside the route body — confirm no DB call was made
    expect(withTenantQuery).not.toHaveBeenCalled();
  });

  it('POST /items returns 422 on invalid body (fewer than 2 variants)', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ name: 'Bad experiment', variants: [{ name: 'control', weight: 1 }] });

    expect(res.status).toBe(422);
  });

  it('GET /items returns 400 on invalid query', async () => {
    const res = await request(buildApp())
      .get('/items')
      .query({ limit: 'not-a-number' });

    expect(res.status).toBe(400);
  });

  it('GET /items returns paginated experiments scoped to the user', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: EXPERIMENT_ID, name: 'Checkout button color', variants: [], status: 'draft', started_at: null, ended_at: null, created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp()).get('/items');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0].id).toBe(EXPERIMENT_ID);
    const [, params] = (withTenantQuery as any).mock.calls[0];
    expect(params[0]).toBe(USER_ID);
  });

  it('DELETE /items/:id removes an experiment owned by the user', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: EXPERIMENT_ID }]);

    const res = await request(buildApp()).delete(`/items/${EXPERIMENT_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(EXPERIMENT_ID);
    const [, params] = (withTenantQuery as any).mock.calls[0];
    expect(params).toEqual([EXPERIMENT_ID, USER_ID]);
  });

  it('DELETE /items/:id returns 404 when experiment not found or not owned', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    const res = await request(buildApp()).delete(`/items/${EXPERIMENT_ID}`);

    expect(res.status).toBe(404);
  });
});
