import express from 'express';
import request from 'supertest';

vi.mock('../../../../../platform/tenancy/src/index', () => ({
  withTenantQuery: vi.fn(),
}));
vi.mock('../../../../../platform/audit/src/index', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../../../platform/metering/src/index', () => ({
  recordUsage: vi.fn().mockResolvedValue(undefined),
}));

import { withTenantQuery } from '../../../../../platform/tenancy/src/index';
import { multiCurrencyRouter } from '../multi-currency';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const RATE_ID = '33333333-3333-3333-3333-333333333333';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { sub: USER_ID, tenantId: TENANT_ID, roles: ['viewer'] };
    next();
  });
  app.use('/', multiCurrencyRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  });
  return app;
}

describe('multi-currency routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('has no DELETE /items/:id route (exchange rates are append-only)', async () => {
    const res = await request(buildApp()).delete(`/items/${RATE_ID}`);

    expect(res.status).toBe(404);
  });

  it('POST /items records an exchange rate and wraps response in data envelope', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: RATE_ID, rate: '1.0842', effective_at: new Date().toISOString(), created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp())
      .post('/items')
      .send({ baseCurrency: 'USD', quoteCurrency: 'EUR', rate: 1.0842 });

    expect(res.status).toBe(201);
    expect(res.body.data.rate).toBe('1.0842');
    expect(res.body.data.id).toBe(RATE_ID);
  });

  it('POST /items returns 422 on invalid body (non-positive rate)', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ baseCurrency: 'USD', quoteCurrency: 'EUR', rate: -1 });

    expect(res.status).toBe(422);
  });

  it('GET /items returns 400 when baseCurrency/quoteCurrency query params are missing', async () => {
    const res = await request(buildApp()).get('/items');

    expect(res.status).toBe(400);
  });

  it('GET /items returns 400 on invalid pagination query', async () => {
    const res = await request(buildApp())
      .get('/items')
      .query({ baseCurrency: 'USD', quoteCurrency: 'EUR', limit: 'not-a-number' });

    expect(res.status).toBe(400);
  });

  it('GET /items returns rates for the given currency pair, tenant-wide', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: RATE_ID, rate: '1.0842', effective_at: new Date().toISOString(), created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp())
      .get('/items')
      .query({ baseCurrency: 'USD', quoteCurrency: 'EUR' });

    expect(res.status).toBe(200);
    expect(res.body.data[0].id).toBe(RATE_ID);
    const [, params] = (withTenantQuery as any).mock.calls[0];
    expect(params[0]).toBe('USD');
    expect(params[1]).toBe('EUR');
  });
});
